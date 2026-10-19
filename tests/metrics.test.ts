import { parseConfig } from '@/sim/config';
import { percentile, toCsv } from '@/sim/metrics';
import { Simulation } from '@/sim/simulation';
import type { MetricsSample } from '@/sim/types';

test('percentile uses linear interpolation', () => {
  expect(percentile([], 50)).toBe(0);
  expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
  expect(percentile([1, 2, 3, 4], 95)).toBeCloseTo(3.85, 5);
});

test('csv header is stable', () => {
  expect(toCsv([]).trim()).toBe(
    'simTimeMs,ordersCompleted,jobsCompleted,throughputPerHour,utilisation,pendingJobs,avgQueueLength',
  );
});

// --- Summary fields beyond the brief's tests ---

function makeMetricsSim(
  overrides: Partial<Record<string, unknown>> = {},
  robots = 1,
): Simulation {
  return new Simulation(
    parseConfig({
      grid: { width: 10, height: 10 },
      robots,
      pods: { count: 5 },
      stations: [{ id: 'S-1', docks: [[0, 5]], queueCapacity: 4, serviceTimeMs: 1000 }],
      orders: {
        arrivalRatePerHour: 0,
        linesPerOrder: { min: 1, max: 1 },
        packingTimeMs: 100,
      },
      ...overrides,
      seed: 5,
    }),
  );
}

function addCompletedOrder(
  sim: Simulation,
  id: string,
  createdAtMs: number,
  completedAtMs: number,
): void {
  sim.world.orders.set(id, {
    id,
    createdAtMs,
    jobIds: [],
    stationId: 'S-1',
    podsTotal: 1,
    podsServiced: 1,
    packingRemainingMs: 0,
    completedAtMs,
  });
}

test('summary reports completions, utilisation, and samples', () => {
  const sim = new Simulation(
    parseConfig({
      grid: { width: 10, height: 10 }, robots: 1, pods: { count: 5 },
      stations: [{ id: 'S-1', docks: [[0, 5]], queueCapacity: 2, serviceTimeMs: 100 }],
      orders: { arrivalRatePerHour: 3600, linesPerOrder: { min: 1, max: 1 }, packingTimeMs: 100 },
      seed: 5,
    }),
  );
  for (let i = 0; i < 50; i++) sim.tick();
  const summary = sim.getMetrics();
  expect(summary.simTimeMs).toBe(5000);
  expect(summary.utilisation.overall).toBeGreaterThanOrEqual(0);
  expect(summary.utilisation.overall).toBeLessThanOrEqual(1);
  expect(sim.getTimeSeries().length).toBe(5);
});

test('csv formats utilisation and throughput with fixed precision', () => {
  const samples: MetricsSample[] = [
    {
      simTimeMs: 1000,
      ordersCompleted: 2,
      jobsCompleted: 3,
      throughputPerHour: 7200,
      utilisation: 0.5,
      pendingJobs: 4,
      avgQueueLength: 1.25,
    },
  ];
  expect(toCsv(samples).trim().split('\n')[1]).toBe('1000,2,3,7200.00,0.5000,4,1.25');
});

test('summary reports completion-time distribution from stored timestamps', () => {
  const sim = makeMetricsSim();
  addCompletedOrder(sim, 'O-1', 1000, 1100);
  addCompletedOrder(sim, 'O-2', 2000, 3200);

  const completion = sim.getMetrics().completionTimeMs;
  expect(completion.mean).toBeCloseTo(650, 5);
  expect(completion.p50).toBeCloseTo(650, 5);
  expect(completion.p90).toBeCloseTo(1090, 5);
  expect(completion.p95).toBeCloseTo(1145, 5);
  expect(completion.p99).toBeCloseTo(1189, 5);
  expect(completion.max).toBe(1200);
});

test('completion-time distribution is zero when no order has completed', () => {
  expect(makeMetricsSim().getMetrics().completionTimeMs).toEqual({
    mean: 0,
    p50: 0,
    p90: 0,
    p95: 0,
    p99: 0,
    max: 0,
  });
});

test('station metrics track busy ticks and queue lengths', () => {
  const sim = makeMetricsSim();
  const station = sim.world.stations[0]!;
  station.queue = [{ podId: 'P-00001', orderId: 'O-1', jobId: 'J-1' }];
  station.serviceRemainingMs = 1000;

  for (let i = 0; i < 10; i++) sim.tick();

  const metrics = sim.getMetrics().stations[0]!;
  expect(metrics.id).toBe('S-1');
  expect(metrics.busyFraction).toBeCloseTo(0.9, 5);
  expect(metrics.avgQueueLength).toBeCloseTo(0.9, 5);
  expect(metrics.maxQueueLength).toBe(1);
});

test('rejected assignments accumulate in the summary', () => {
  const sim = makeMetricsSim();
  const observation = sim.observe();
  const result = sim.applyAllocation(observation.allocationSeq, [
    { jobId: 'J-missing', robotId: 'R-missing', stationId: 'S-1' },
  ]);

  expect(result.rejected).toHaveLength(1);
  expect(sim.getMetrics().rejectedAssignments).toBe(1);
});

test('rolling throughput counts only completions within the last hour', () => {
  const sim = makeMetricsSim({ movement: { tickMs: 1000 } });
  for (let i = 0; i < 3601; i++) sim.tick();

  expect(sim.timeMs).toBe(3_601_000);
  // The window starts at 1,000 ms and the bound is exclusive.
  addCompletedOrder(sim, 'O-old', 500, 1000);
  addCompletedOrder(sim, 'O-recent', 1500, 2000);

  const summary = sim.getMetrics();
  expect(summary.throughputWindowPerHour).toBe(1);
  expect(summary.throughputPerHour).toBe(0);
});

test('utilisation accumulates robot state time at tick granularity', () => {
  const sim = makeMetricsSim({}, 2);
  // An unassigned robot with an empty path is parked and returns to idle at
  // the end of the movement phase, so keep this one assigned to a real job to
  // hold the moving_empty state across all ten ticks.
  const robot = sim.world.robots[0]!;
  const other = sim.world.robots[1]!;
  const jobId = 'J-0000001';
  sim.world.jobs.set(jobId, {
    id: jobId,
    orderId: 'O-000001',
    podId: 'P-00001',
    pickup: { x: 5, y: 5 },
    candidateStations: ['S-1'],
    dependsOn: [],
    priority: 0,
    createdAtMs: 0,
    status: 'assigned',
    stationId: 'S-1',
    robotId: robot.id,
    completedAtMs: null,
  });
  robot.cell = { x: 0, y: 0 };
  robot.path = [{ x: 1, y: 0 }];
  robot.jobId = jobId;
  robot.status = 'moving_empty';
  // Keep the second robot away from the first robot's route regardless of the
  // seeded spawn layout.
  other.cell = { x: 9, y: 9 };
  other.path = [];
  other.status = 'idle';

  for (let i = 0; i < 10; i++) sim.tick();

  const utilisation = sim.getMetrics().utilisation;
  expect(utilisation.overall).toBeCloseTo(0.45, 5);
  expect(utilisation.idle).toBeCloseTo(0.55, 5);
  expect(utilisation.movingEmpty).toBeCloseTo(0.45, 5);
  expect(utilisation.movingLoaded).toBe(0);
});
