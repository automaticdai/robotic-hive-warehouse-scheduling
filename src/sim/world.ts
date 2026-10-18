import type { Cell, SimConfig } from './config';
import { createRng } from './rng';
import type { Pod, Robot, Station, World } from './types';

/** Stable string key for a grid cell. */
export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.y}`;
}

/**
 * Builds a deterministic world for a config seed. Robot and pod start cells are
 * drawn from a seeded shuffle of the grid, so each set occupies distinct cells.
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

  const cellIndices = Array.from({ length: totalCells }, (_, index) => index);
  for (let index = cellIndices.length - 1; index > 0; index--) {
    const swapIndex = rng.int(index + 1);
    const current = cellIndices[index]!;
    cellIndices[index] = cellIndices[swapIndex]!;
    cellIndices[swapIndex] = current;
  }

  const cellAt = (index: number): Cell => ({
    x: index % width,
    y: Math.floor(index / width),
  });

  const robots: Robot[] = Array.from({ length: config.robots }, (_, index) => ({
    id: `R-${String(index + 1).padStart(4, '0')}`,
    cell: cellAt(cellIndices[index]!),
    status: 'idle',
    battery: 1,
    jobId: null,
    carrying: false,
    path: [],
    assignedAtMs: 0,
    blockedTicks: 0,
  }));

  const pods: Pod[] = Array.from({ length: config.pods.count }, (_, index) => ({
    id: `P-${String(index + 1).padStart(5, '0')}`,
    cell: cellAt(cellIndices[config.robots + index]!),
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
