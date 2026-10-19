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

test('pause aborts an in-flight turn while an allocation is pending', async () => {
  const sim = new Simulation(parseConfig(baseConfig));
  let resolve!: (value: never[]) => void;
  const allocator = {
    allocate: () => new Promise<never[]>((r) => { resolve = r; }),
  };
  const loop = new SimLoop({ sim, allocator, tickMs: 100, now: () => 0 });
  loop.setSpeed(16);

  const pending = loop.advanceTo(1000);
  await Promise.resolve();
  loop.pause();
  resolve([]);
  await pending;

  expect(sim.timeMs).toBe(0);
});

test('a pause mid-turn does not replay the paused interval on resume', async () => {
  vi.useFakeTimers();
  try {
    const sim = new Simulation(parseConfig(baseConfig));
    let resolve!: (value: never[]) => void;
    const allocator = {
      allocate: () => new Promise<never[]>((r) => { resolve = r; }),
    };
    const loop = new SimLoop({
      sim,
      allocator,
      tickMs: 100,
      now: () => Date.now(),
    });

    loop.start();
    await vi.advanceTimersByTimeAsync(100);
    loop.pause();
    vi.advanceTimersByTime(10_000);
    loop.start();
    resolve([]);
    await vi.advanceTimersByTimeAsync(100);

    expect(sim.timeMs).toBe(100);
    loop.pause();
  } finally {
    vi.useRealTimers();
  }
});

test('reports achieved speed over a wall-time window and null while paused', async () => {
  vi.useFakeTimers();
  try {
    const sim = new Simulation(parseConfig(baseConfig));
    const loop = new SimLoop({
      sim,
      allocator: new FcfsAllocator(),
      tickMs: 100,
      now: () => Date.now(),
    });
    loop.setSpeed(2);
    loop.start();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(loop.achievedSpeed).not.toBeNull();
    expect(loop.achievedSpeed!).toBeCloseTo(2, 1);

    loop.pause();
    expect(loop.achievedSpeed).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test('achieved speed starts as null until a window has elapsed', () => {
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
    expect(loop.achievedSpeed).toBeNull();
    loop.pause();
  } finally {
    vi.useRealTimers();
  }
});

test('reports lag when a turn completes long after its callback timestamp', async () => {
  vi.useFakeTimers();
  try {
    const sim = new Simulation(parseConfig(baseConfig));
    let now = 0;
    const loop = new SimLoop({
      sim,
      allocator: new FcfsAllocator(),
      tickMs: 100,
      now: () => now,
    });
    loop.start();

    // The timer callback carries a stale timestamp (100 ms after start), but
    // the turn only gets to run after a full second of real time has passed.
    // Only one tick of simulation time is granted by the pacing delta, so the
    // observed rate must be far below the requested 1×.
    now = 1_000;
    await loop.advanceTo(100);

    expect(sim.timeMs).toBe(100);
    expect(loop.achievedSpeed).not.toBeNull();
    expect(loop.achievedSpeed!).toBeGreaterThan(0);
    expect(loop.achievedSpeed!).toBeLessThan(1);
    expect(loop.achievedSpeed!).toBeCloseTo(0.1, 2);
    loop.pause();
  } finally {
    vi.useRealTimers();
  }
});

test('normal pacing reports the requested achieved speed', async () => {
  vi.useFakeTimers();
  try {
    const sim = new Simulation(parseConfig(baseConfig));
    let now = 0;
    const loop = new SimLoop({
      sim,
      allocator: new FcfsAllocator(),
      tickMs: 100,
      now: () => now,
    });
    loop.setSpeed(2);
    loop.start();

    now = 500;
    await loop.advanceTo(500);
    now = 1_000;
    await loop.advanceTo(1_000);

    expect(sim.timeMs).toBe(2_000);
    expect(loop.achievedSpeed!).toBeCloseTo(2, 2);
    loop.pause();
  } finally {
    vi.useRealTimers();
  }
});

test('a large tick does not report false lag after a single tick', async () => {
  vi.useFakeTimers();
  try {
    const sim = new Simulation(
      parseConfig({ ...baseConfig, movement: { tickMs: 2_000 } }),
    );
    let now = 0;
    const loop = new SimLoop({
      sim,
      allocator: new FcfsAllocator(),
      tickMs: 2_000,
      now: () => now,
    });
    loop.start();

    // One 2 s tick within a 4 s window is a full 1× rate. A fixed 500 ms
    // window would have measured zero ticks here and falsely cried lag.
    now = 2_000;
    await loop.advanceTo(2_000);
    expect(sim.timeMs).toBe(2_000);
    expect(loop.achievedSpeed).toBeNull();

    now = 4_000;
    await loop.advanceTo(4_000);
    expect(loop.achievedSpeed!).toBeCloseTo(1, 2);
    loop.pause();
  } finally {
    vi.useRealTimers();
  }
});

test('changing speed resets the achieved-speed window', async () => {
  vi.useFakeTimers();
  try {
    const sim = new Simulation(parseConfig(baseConfig));
    let now = 0;
    const loop = new SimLoop({
      sim,
      allocator: new FcfsAllocator(),
      tickMs: 100,
      now: () => now,
    });
    loop.setSpeed(2);
    loop.start();

    now = 500;
    await loop.advanceTo(500);
    expect(loop.achievedSpeed!).toBeCloseTo(2, 2);

    loop.setSpeed(4);
    expect(loop.achievedSpeed).toBeNull();

    now = 1_100;
    await loop.advanceTo(1_100);
    expect(loop.achievedSpeed!).toBeCloseTo(4, 2);
    loop.pause();
  } finally {
    vi.useRealTimers();
  }
});

test('reports successful allocations to onAllocationResult', async () => {
  const sim = new Simulation(parseConfig(baseConfig));
  const results: (unknown | null)[] = [];
  const loop = new SimLoop({
    sim,
    allocator: new FcfsAllocator(),
    tickMs: 100,
    now: () => 0,
    onAllocationResult: (result) => results.push(result),
  });

  await loop.advanceTo(100);

  expect(results).toEqual([null]);
});

test('reports allocator failures to onAllocationResult and falls back to FCFS', async () => {
  const sim = new Simulation(parseConfig(baseConfig));
  const failure = new Error('allocator down');
  const results: (unknown | null)[] = [];
  const loop = new SimLoop({
    sim,
    allocator: {
      allocate: () => {
        throw failure;
      },
    },
    tickMs: 100,
    now: () => 0,
    onAllocationResult: (result) => results.push(result),
  });

  await loop.advanceTo(100);

  expect(results).toHaveLength(1);
  expect(results[0]).toBe(failure);
  expect(sim.timeMs).toBe(100);
});
