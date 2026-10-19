import { parseConfig } from '@/sim/config';
import type { WorkerEvent } from '@/worker/protocol';

const baseConfig = {
  grid: { width: 10, height: 10 },
  robots: 2,
  pods: { count: 20 },
  stations: [{ id: 'S-1', docks: [[0, 5]], queueCapacity: 2, serviceTimeMs: 1000 }],
  seed: 1,
};

function postCommand(command: unknown): void {
  const handler = (
    globalThis as unknown as {
      onmessage: ((event: MessageEvent) => void) | null;
    }
  ).onmessage;
  if (handler === null) throw new Error('worker onmessage handler is not installed');
  handler({ data: command } as MessageEvent);
}

test('ignores allocation failures from a superseded allocator', async () => {
  const events: WorkerEvent[] = [];
  vi.stubGlobal('postMessage', (message: WorkerEvent) => {
    events.push(message);
  });

  let rejectAllocation: ((reason: Error) => void) | null = null;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/health')) {
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    }
    if (url.endsWith('/sessions')) {
      return new Response(JSON.stringify({ sessionId: 's1', strategy: 'test' }), {
        status: 200,
      });
    }
    if (url.endsWith('/allocate')) {
      return new Promise<Response>((_resolve, reject) => {
        rejectAllocation = reject;
      });
    }
    // Session disposal and any other sidecar endpoint.
    return new Response('', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);

  const healthCalls = () =>
    fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/health')).length;

  // Import after installing the globals: the worker module installs its
  // onmessage handler and intervals at module scope.
  await import('@/worker/sim.worker');

  postCommand({
    type: 'init',
    config: parseConfig(baseConfig),
    options: { strategy: 'python:test', pythonUrl: 'http://sidecar.test', speed: 1 },
  });
  expect(events.some((event) => event.type === 'ready')).toBe(true);

  // Drive one tick; the Python allocator's /allocate request stays pending.
  postCommand({ type: 'step' });
  await vi.waitFor(() => {
    expect(rejectAllocation).not.toBeNull();
  });

  // Swap strategies while the old allocation is still in flight.
  postCommand({ type: 'selectStrategy', strategy: 'builtin:fcfs' });
  await vi.waitFor(() => {
    expect(healthCalls()).toBeGreaterThanOrEqual(2);
  });
  const healthCallsBeforeFailure = healthCalls();

  rejectAllocation!(new Error('sidecar died'));
  await vi.waitFor(() => {
    expect(
      events.some((event) => event.type === 'status' && event.simTimeMs === 100),
    ).toBe(true);
  });

  // The superseded allocator's failure must not leak into status or trigger a
  // health probe; the step still completed through the worker's own state.
  for (const event of events) {
    if (event.type === 'status') expect(event.error).toBeNull();
  }
  expect(healthCalls()).toBe(healthCallsBeforeFailure);
});
