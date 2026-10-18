/* eslint-disable @typescript-eslint/no-explicit-any */
import { SimClient } from '@/lib/simClient';
import { encodeSnapshot } from '@/worker/protocol';

class FakeWorker {
  messages: any[] = [];
  listeners: ((event: MessageEvent) => void)[] = [];
  postMessage(message: any) { this.messages.push(message); }
  addEventListener(_type: string, listener: (event: MessageEvent) => void) { this.listeners.push(listener); }
  terminate() {}
  emit(data: any) { for (const listener of this.listeners) listener({ data } as MessageEvent); }
}

test('forwards commands and dispatches metrics from status events', () => {
  const worker = new FakeWorker();
  const client = new SimClient(worker as any);
  client.pause();
  expect(worker.messages.at(-1)).toEqual({ type: 'pause' });
  const received: any[] = [];
  client.onMetrics((metrics) => received.push(metrics));
  worker.emit({
    type: 'status', running: false, simTimeMs: 0, effectiveSpeed: 1,
    pythonOnline: false, error: null, metrics: { ordersCompleted: 3 },
  });
  expect(received).toHaveLength(1);
  expect(received[0].ordersCompleted).toBe(3);
});

test('decodes snapshot events for onSnapshot subscribers', () => {
  const worker = new FakeWorker();
  const client = new SimClient(worker as any);
  const received: any[] = [];
  const unsubscribe = client.onSnapshot((snapshot) => received.push(snapshot));

  const snapshot = {
    timeMs: 500,
    robotIds: ['R-0001'],
    robots: {
      x: new Float32Array([3]), y: new Float32Array([4]),
      state: new Uint8Array([1]), carrying: new Uint8Array([0]),
      battery: new Float32Array([0.5]),
    },
    pods: { x: new Float32Array([9]), y: new Float32Array([8]), visible: new Uint8Array([1]) },
    stations: [{ id: 'S-1', queueLength: 2, capacity: 8, busy: true }],
    metrics: { ordersCompleted: 1 } as any,
  };
  worker.emit({ type: 'snapshot', ...encodeSnapshot(snapshot), metrics: snapshot.metrics });

  expect(received).toHaveLength(1);
  expect(received[0].robotIds).toEqual(['R-0001']);
  expect(Array.from(received[0].robots.x)).toEqual([3]);
  expect(Array.from(received[0].robots.battery)).toEqual([0.5]);
  expect(received[0].stations[0].queueLength).toBe(2);

  unsubscribe();
  worker.emit({ type: 'snapshot', ...encodeSnapshot(snapshot), metrics: snapshot.metrics });
  expect(received).toHaveLength(1);
});
