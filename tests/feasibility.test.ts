import { parseConfig } from '@/sim/config';
import { FcfsAllocator } from '@/sim/fcfs';
import { Simulation } from '@/sim/simulation';
import type { MetricsSummary } from '@/sim/simulation';

/**
 * A small scenario whose station capacity comfortably exceeds demand. It
 * exercises the whole tick pipeline (orders, allocation, traffic, deposit,
 * service, packing) in a few hundred simulated seconds.
 */
function runFeasibleScenario(): MetricsSummary {
  const sim = new Simulation(
    parseConfig({
      grid: { width: 20, height: 20 },
      robots: 20,
      pods: { count: 100, replenishDelayMs: 5000 },
      stations: [
        { id: 'S-1', docks: [[0, 10], [0, 11]], queueCapacity: 8, serviceTimeMs: 500 },
      ],
      orders: {
        arrivalRatePerHour: 600,
        linesPerOrder: { min: 1, max: 1 },
        packingTimeMs: 1000,
      },
      allocation: {
        intervalMs: 1000,
        strategy: 'builtin:fcfs',
        timeoutMs: 2000,
        onFailure: 'fallback-fcfs',
      },
      movement: { tickMs: 100 },
      seed: 7,
    }),
  );
  const allocator = new FcfsAllocator();

  for (let tick = 0; tick < 1200; tick++) {
    if (sim.isAllocationDue()) {
      const observation = sim.observe();
      sim.applyAllocation(observation.allocationSeq, allocator.allocate(observation));
    }
    sim.tick();
  }

  return sim.getMetrics();
}

test('a capacity-feasible scenario completes orders without deadlock runaway', () => {
  const metrics = runFeasibleScenario();

  expect(metrics.simTimeMs).toBe(120_000);
  expect(metrics.ordersCompleted).toBeGreaterThanOrEqual(1);
  expect(metrics.jobsCompleted).toBeGreaterThanOrEqual(1);
  // Traffic recovery may fire occasionally, but never in a runaway loop.
  expect(metrics.deadlockEvents).toBeLessThan(500);
});

test('the feasible scenario is deterministic', () => {
  const first = runFeasibleScenario();
  const second = runFeasibleScenario();

  expect(second).toEqual(first);
});
