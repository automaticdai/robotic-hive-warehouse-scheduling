import { parseConfig } from '@/sim/config';
import { FcfsAllocator } from '@/sim/fcfs';
import { Simulation } from '@/sim/simulation';
import { SimLoop } from '@/lib/simLoop';

const baseConfig = {
  grid: { width: 10, height: 10 },
  robots: 2,
  pods: { count: 20 },
  stations: [{ id: 'S-1', docks: [[0, 5]], queueCapacity: 2, serviceTimeMs: 1000 }],
  seed: 1,
};

function makeLoop(configOverrides = {}) {
  const sim = new Simulation(parseConfig({ ...baseConfig, ...configOverrides }));
  let now = 0;
  const loop = new SimLoop({ sim, allocator: new FcfsAllocator(), tickMs: 100, now: () => now });
  return { sim, loop, setNow: (value: number) => { now = value; } };
}

test('one tick per 100 ms at 1x', async () => {
  const { sim, loop, setNow } = makeLoop();
  setNow(100);
  await loop.advanceTo(100);
  expect(sim.timeMs).toBe(100);
});

test('two ticks per 100 ms at 2x', async () => {
  const { sim, loop, setNow } = makeLoop();
  loop.setSpeed(2);
  setNow(100);
  await loop.advanceTo(100);
  expect(sim.timeMs).toBe(200);
});

test('pauses at an allocation boundary until the allocator resolves', async () => {
  const sim = new Simulation(parseConfig(baseConfig));
  let now = 0;
  let resolve!: (value: never[]) => void;
  let calls = 0;
  const allocator = {
    allocate: () =>
      ++calls === 1
        ? new Promise<never[]>((r) => { resolve = r; })
        : Promise.resolve([]),
  };
  const loop = new SimLoop({ sim, allocator, tickMs: 100, now: () => now });
  now = 1000;
  const pending = loop.advanceTo(1000);
  await Promise.resolve();
  expect(sim.timeMs).toBe(0);
  resolve([]);
  await pending;
  expect(sim.timeMs).toBe(1000);
});

test('resuming after a pause does not replay the paused wall time', async () => {
  vi.useFakeTimers();
  try {
    const sim = new Simulation(parseConfig(baseConfig));
    const loop = new SimLoop({
      sim,
      allocator: new FcfsAllocator(),
      tickMs: 100,
      now: () => Date.now(),
    });

    loop.start();
    loop.pause();
    vi.advanceTimersByTime(10_000);
    loop.start();
    await vi.advanceTimersByTimeAsync(100);

    expect(sim.timeMs).toBe(100);
    loop.pause();
  } finally {
    vi.useRealTimers();
  }
});
