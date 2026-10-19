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

/**
 * Robot state palette. The four working states are validated for adjacent
 * CVD separation on the concrete floor; idle is off-white, so parked robots
 * read as robots against the slate pods without competing with traffic.
 */
const STATE_COLORS: Record<RobotStatus, string> = {
  idle: '#f4f5f1',
  moving_empty: '#2f6fd1',
  moving_loaded: '#0f9e74',
  waiting: '#e0542e',
  at_station: '#7b4fd0',
};

/** Human-readable robot state names, shared by the HUD legend and inspector. */
export const STATE_LABELS: Record<RobotStatus, string> = {
  idle: 'Idle',
  moving_empty: 'To pickup',
  moving_loaded: 'Carrying pod',
  waiting: 'Blocked',
  at_station: 'Queued at port',
};

/** Floor-plan palette shared by the scene components. */
export const FLOOR_PALETTE = {
  background: '#e7e8e3',
  floor: '#d9dbd5',
  storage: '#c3c8c5',
  gridLine: '#59646a',
  podStored: '#66757a',
  podReserved: '#f2b705',
  carriedPod: '#3d4a4f',
  safety: '#f2c230',
  ink: '#1c2427',
  dock: '#1c2427',
} as const;

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

/** A cell-aligned rectangle on the floor, in grid cells (x/y inclusive start). */
export interface FloorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The hatched port zone in front of a station: the bounding box of its docks,
 * grown by `clearance - 1` cells and clamped to the grid. It is exactly the
 * area pods are kept out of for a station on a grid edge.
 */
export function portZoneRect(
  station: StationConfig,
  grid: GridConfig,
  clearance: number,
): FloorRect {
  const grow = Math.max(0, clearance - 1);
  const xs = station.docks.map((dock) => dock.x);
  const ys = station.docks.map((dock) => dock.y);
  const x0 = Math.max(0, Math.min(...xs) - grow);
  const y0 = Math.max(0, Math.min(...ys) - grow);
  const x1 = Math.min(grid.width - 1, Math.max(...xs) + grow);
  const y1 = Math.min(grid.height - 1, Math.max(...ys) + grow);
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** World-space centre and size of a cell rectangle. */
export function rectToWorld(
  rect: FloorRect,
  grid: GridConfig,
): { x: number; z: number; width: number; depth: number } {
  return {
    x: rect.x + rect.width / 2 - grid.width / 2,
    z: rect.y + rect.height / 2 - grid.height / 2,
    width: rect.width,
    depth: rect.height,
  };
}

/** Outward unit direction from the grid edge nearest a station's docks. */
export function stationOutward(
  station: StationConfig,
  grid: GridConfig,
): { x: number; z: number } {
  const dockCount = station.docks.length;
  const cx = station.docks.reduce((sum, dock) => sum + dock.x, 0) / dockCount;
  const cy = station.docks.reduce((sum, dock) => sum + dock.y, 0) / dockCount;
  const edges = [
    { distance: cx, x: -1, z: 0 },
    { distance: grid.width - 1 - cx, x: 1, z: 0 },
    { distance: cy, x: 0, z: -1 },
    { distance: grid.height - 1 - cy, x: 0, z: 1 },
  ];
  const nearest = edges.reduce((best, edge) => (edge.distance < best.distance ? edge : best));
  return { x: nearest.x, z: nearest.z };
}
