import type { Cell, SimConfig } from './config';
import { apronMask, podSlots, storageCells } from './layout';
import { createRng, type Rng } from './rng';
import type { Pod, Robot, Station, World } from './types';

/** Stable string key for a grid cell. */
export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

/** In-place Fisher–Yates shuffle driven by the world RNG. */
function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let index = items.length - 1; index > 0; index--) {
    const swapIndex = rng.int(index + 1);
    const current = items[index]!;
    items[index] = items[swapIndex]!;
    items[swapIndex] = current;
  }
  return items;
}

/**
 * Builds a deterministic world for a config seed. Each pod gets a fixed home
 * slot in a compact block at the centre of the storage area (clear of station
 * ports); it is stored there, fetched from there, and returns there after
 * service. Robots start on a seeded shuffle of cells outside the station
 * aprons.
 */
export function createWorld(config: SimConfig): World {
  const { width, height } = config.grid;
  const totalCells = width * height;
  const requiredCells = config.robots + config.pods.count;

  if (requiredCells > totalCells) {
    throw new Error(
      `robots (${config.robots}) + pods.count (${config.pods.count}) exceeds grid cell count (${totalCells})`,
    );
  }

  const rng = createRng(config.seed);

  const available = storageCells(config).length;
  if (config.pods.count > available) {
    throw new Error(
      `pods.count (${config.pods.count}) exceeds the ${available} storage slots clear of station ports`,
    );
  }
  const podCells = podSlots(config, config.pods.count);

  // Robots run on top of the grid and drive over stored pods, so they start
  // spread across the whole hive (pod slots included). Station aprons are
  // filled only when the rest of the grid is full, and dock cells last.
  const dockCells = new Set(config.stations.flatMap((station) => station.docks.map(cellKey)));
  const apron = apronMask(config);
  const open: Cell[] = [];
  const nearPorts: Cell[] = [];
  const docks: Cell[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = { x, y };
      if (dockCells.has(cellKey(cell))) docks.push(cell);
      else if (apron[y * width + x] === 1) nearPorts.push(cell);
      else open.push(cell);
    }
  }
  const robotCells = [...shuffle(open, rng), ...shuffle(nearPorts, rng), ...docks];

  const robots: Robot[] = Array.from({ length: config.robots }, (_, index) => ({
    id: `R-${String(index + 1).padStart(4, '0')}`,
    cell: robotCells[index]!,
    status: 'idle',
    battery: 1,
    jobId: null,
    carrying: false,
    path: [],
    assignedAtMs: 0,
    blockedTicks: 0,
  }));

  const pods: Pod[] = podCells.map((cell, index) => ({
    id: `P-${String(index + 1).padStart(5, '0')}`,
    cell,
    available: true,
    reservedByJobId: null,
    replenishAtMs: null,
  }));

  const stations: Station[] = config.stations.map((station) => ({
    id: station.id,
    docks: station.docks.map((dock) => ({ x: dock.x, y: dock.y })),
    queueCapacity: station.queueCapacity,
    serviceTimeMs: station.serviceTimeMs,
    queue: [],
    serviceRemainingMs: 0,
  }));

  return {
    config,
    simTimeMs: 0,
    tick: 0,
    robots,
    pods,
    stations,
    jobs: new Map(),
    orders: new Map(),
    rng,
  };
}
