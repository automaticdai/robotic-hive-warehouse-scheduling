import type { Cell, GridConfig, StationConfig } from '@/sim/config';
import type { Snapshot } from '@/sim/simulation';
import type { RobotStatus } from '@/sim/types';

/** Snapshot state-byte order; index is the `robots.state` value. */
export const ROBOT_STATUS_ORDER: readonly RobotStatus[] = [
  'idle',
  'moving_empty',
  'moving_loaded',
  'waiting',
  'at_station',
];

const STATE_COLORS: Record<RobotStatus, string> = {
  idle: '#5f7d8c',
  moving_empty: '#e8a33d',
  moving_loaded: '#d8e8e2',
  waiting: '#c0442f',
  at_station: '#9b6bd6',
};

export interface WorldPosition {
  x: number;
  z: number;
}

/**
 * Writes the world-space centre for a (possibly fractional) grid cell into
 * `target`. Render loops reuse one target so per-frame interpolation does not
 * allocate.
 */
export function cellToWorldInto(
  cellX: number,
  cellY: number,
  grid: GridConfig,
  cellSize: number,
  target: WorldPosition,
): WorldPosition {
  target.x = (cellX - (grid.width - 1) / 2) * cellSize;
  target.z = (cellY - (grid.height - 1) / 2) * cellSize;
  return target;
}

/**
 * Maps a grid cell centre to world space. The grid is centred on the origin,
 * so the outermost cell centres sit half a cell inside the floor bounds.
 */
export function cellToWorld(
  cell: Cell,
  grid: GridConfig,
  cellSize = 1,
): WorldPosition {
  return cellToWorldInto(cell.x, cell.y, grid, cellSize, { x: 0, z: 0 });
}

/** Linear blend used to render one snapshot interval behind the worker. */
export function interpolate(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

/** Stable colour for a robot state, shared by the scene and the HUD legend. */
export function stateColor(status: RobotStatus): string {
  return STATE_COLORS[status];
}

/**
 * Blends two snapshots' robot cell coordinates, then converts the blended cell
 * to centred world space. Snapshot coordinates are grid cells, not world
 * units, so the conversion must happen after interpolation.
 */
export function interpolatedWorldPosition(
  previous: Snapshot | null,
  current: Snapshot,
  alpha: number,
  index: number,
  grid: GridConfig,
  target: WorldPosition = { x: 0, z: 0 },
  cellSize = 1,
): WorldPosition {
  const currentCellX = current.robots.x[index] ?? 0;
  const currentCellY = current.robots.y[index] ?? 0;

  const hasPrevious =
    previous !== null &&
    index < previous.robots.x.length &&
    index < previous.robots.y.length &&
    index < current.robots.x.length &&
    index < current.robots.y.length;

  const cellX = hasPrevious
    ? interpolate(previous.robots.x[index], currentCellX, alpha)
    : currentCellX;
  const cellY = hasPrevious
    ? interpolate(previous.robots.y[index], currentCellY, alpha)
    : currentCellY;

  return cellToWorldInto(cellX, cellY, grid, cellSize, target);
}

/**
 * Places a station outside the grid edge its docks sit on. Docks are averaged
 * to a centroid, then pushed outward from the nearest edge far enough that the
 * station block clears the floor.
 */
export function stationWorldPosition(
  station: StationConfig,
  grid: GridConfig,
  cellSize = 1,
  outsetCells = 1.5,
): { x: number; z: number } {
  const dockCount = station.docks.length;
  const centroid: Cell = {
    x: station.docks.reduce((sum, dock) => sum + dock.x, 0) / dockCount,
    y: station.docks.reduce((sum, dock) => sum + dock.y, 0) / dockCount,
  };
  const base = cellToWorld(centroid, grid, cellSize);

  const edges = [
    { axis: 'x' as const, distance: centroid.x, direction: -1 },
    { axis: 'x' as const, distance: grid.width - 1 - centroid.x, direction: 1 },
    { axis: 'z' as const, distance: centroid.y, direction: -1 },
    { axis: 'z' as const, distance: grid.height - 1 - centroid.y, direction: 1 },
  ];
  const nearest = edges.reduce((best, edge) =>
    edge.distance < best.distance ? edge : best,
  );

  const offset = nearest.direction * cellSize * outsetCells;
  return nearest.axis === 'x'
    ? { x: base.x + offset, z: base.z }
    : { x: base.x, z: base.z + offset };
}
