import { ConfigError, defaultConfig, parseConfig } from '@/sim/config';
import { FcfsAllocator } from '@/sim/fcfs';
import { storageCells, storageRect } from '@/sim/layout';
import { manhattan } from '@/sim/movement';
import { POD_STATE_CODE, Simulation } from '@/sim/simulation';
import { cellKey, createWorld } from '@/sim/world';

const scenario = {
  grid: { width: 20, height: 20 },
  robots: 20,
  pods: { count: 100, replenishDelayMs: 2000 },
  stations: [{ id: 'S-1', docks: [[0, 10], [0, 11]], queueCapacity: 8, serviceTimeMs: 500 }],
  orders: { arrivalRatePerHour: 1200, linesPerOrder: { min: 1, max: 2 }, packingTimeMs: 1000 },
  seed: 7,
};

test('the default storage block keeps a port aisle along every dock edge', () => {
  expect(storageRect(defaultConfig)).toEqual({ x: 3, y: 0, width: 94, height: 100 });

  const config = parseConfig(scenario);
  expect(storageRect(config)).toEqual({ x: 3, y: 0, width: 17, height: 20 });
});

test('pods spawn only in storage slots clear of every dock', () => {
  const config = parseConfig(scenario);
  const slots = new Set(storageCells(config).map(cellKey));
  const docks = config.stations.flatMap((station) => station.docks);
  const world = createWorld(config);

  for (const pod of world.pods) {
    expect(slots.has(cellKey(pod.cell))).toBe(true);
    for (const dock of docks) {
      expect(manhattan(pod.cell, dock)).toBeGreaterThanOrEqual(config.layout.portClearance);
    }
  }
});

test('robots do not start on dock cells while other cells are free', () => {
  const config = parseConfig(scenario);
  const docks = new Set(config.stations.flatMap((station) => station.docks.map(cellKey)));
  const world = createWorld(config);
  for (const robot of world.robots) expect(docks.has(cellKey(robot.cell))).toBe(false);
});

test('an explicit storage rectangle confines pods to it', () => {
  const config = parseConfig({
    ...scenario,
    layout: { storage: { x: 8, y: 4, width: 10, height: 12 } },
  });
  const world = createWorld(config);
  for (const pod of world.pods) {
    expect(pod.cell.x).toBeGreaterThanOrEqual(8);
    expect(pod.cell.x).toBeLessThan(18);
    expect(pod.cell.y).toBeGreaterThanOrEqual(4);
    expect(pod.cell.y).toBeLessThan(16);
  }
});

test('a storage rectangle outside the grid is rejected', () => {
  expect(() =>
    parseConfig({ ...scenario, layout: { storage: { x: 15, y: 0, width: 10, height: 5 } } }),
  ).toThrow(/storage rectangle extends outside/);
});

test('more pods than storage slots is rejected', () => {
  expect(() =>
    parseConfig({ ...scenario, layout: { storage: { x: 5, y: 5, width: 5, height: 5 } } }),
  ).toThrow(ConfigError);
});

test('serviced pods return to their own home slot', () => {
  const sim = new Simulation(parseConfig(scenario));
  const homes = sim.world.pods.map((pod) => ({ ...pod.cell }));
  const allocator = new FcfsAllocator();
  let sawReserved = false;
  let sawOut = false;

  for (let tick = 0; tick < 1500; tick++) {
    if (sim.isAllocationDue()) {
      const observation = sim.observe();
      sim.applyAllocation(observation.allocationSeq, allocator.allocate(observation));
    }
    sim.tick();
    if (tick % 10 === 0) {
      const { state } = sim.getSnapshot().pods;
      sawReserved ||= state.includes(POD_STATE_CODE.reserved);
      sawOut ||= state.includes(POD_STATE_CODE.out);
    }
  }

  expect(sim.getMetrics().jobsCompleted).toBeGreaterThan(5);
  expect(sim.world.pods.map((pod) => pod.cell)).toEqual(homes);
  expect(sawReserved).toBe(true);
  expect(sawOut).toBe(true);
});

test('pods form one compact block centred in the storage area', () => {
  const config = parseConfig(scenario);
  const world = createWorld(config);
  const xs = world.pods.map((pod) => pod.cell.x);
  const ys = world.pods.map((pod) => pod.cell.y);
  const area = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1);
  expect(area).toBeLessThanOrEqual(Math.ceil(config.pods.count * 1.25));

  const rect = storageRect(config);
  const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centreY = (Math.min(...ys) + Math.max(...ys)) / 2;
  expect(Math.abs(centreX - (rect.x + (rect.width - 1) / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(centreY - (rect.y + (rect.height - 1) / 2))).toBeLessThanOrEqual(1);
});
