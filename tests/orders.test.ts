import { parseConfig } from '@/sim/config';
import { OrderGenerator } from '@/sim/orders';
import type { Rng } from '@/sim/rng';
import { createWorld } from '@/sim/world';

const config = parseConfig({
  grid: { width: 20, height: 20 },
  robots: 4,
  pods: { count: 50 },
  stations: [
    { id: 'S-1', docks: [[0, 5]], queueCapacity: 4, serviceTimeMs: 1000 },
    { id: 'S-2', docks: [[19, 5]], queueCapacity: 4, serviceTimeMs: 1000 },
  ],
  orders: { arrivalRatePerHour: 3600, linesPerOrder: { min: 2, max: 2 } },
  seed: 42,
});

test('each order expands into one ready trip per line', () => {
  const world = createWorld(config);
  const generator = new OrderGenerator(world, config.orders, world.rng);
  world.simTimeMs = 60_000;
  const orders = generator.generateDueOrders();
  expect(orders.length).toBeGreaterThan(0);
  for (const order of orders) {
    expect(order.jobIds).toHaveLength(2);
    for (const jobId of order.jobIds) {
      const job = world.jobs.get(jobId)!;
      expect(job.orderId).toBe(order.id);
      expect(job.status).toBe('ready');
      expect(job.dependsOn).toEqual([]);
      expect(job.candidateStations).toEqual(['S-1', 'S-2']);
    }
  }
});

test('a pod is never reserved by two live jobs', () => {
  const world = createWorld(config);
  const generator = new OrderGenerator(world, config.orders, world.rng);
  world.simTimeMs = 60_000;
  generator.generateDueOrders();
  const reserved = [...world.jobs.values()].map((job) => job.podId);
  expect(new Set(reserved).size).toBe(reserved.length);
});

test('a zero interarrival sample is clamped so generation always advances', () => {
  const world = createWorld(
    parseConfig({
      grid: { width: 3, height: 3 },
      robots: 1,
      pods: { count: 1 },
      layout: { portClearance: 0 },
      stations: [{ id: 'S-1', docks: [[0, 0]], queueCapacity: 1, serviceTimeMs: 1000 }],
      orders: { arrivalRatePerHour: 3600, linesPerOrder: { min: 1, max: 1 } },
      seed: 1,
    }),
  );
  const zeroRng: Rng = {
    next: () => 0,
    int: () => 0,
    pick: <T>(items: readonly T[]) => items[0]!,
  };
  const generator = new OrderGenerator(world, world.config.orders, zeroRng);

  expect(generator.generateDueOrders()).toEqual([]);

  world.simTimeMs = 1;
  const orders = generator.generateDueOrders();
  expect(orders).toHaveLength(1);
});
