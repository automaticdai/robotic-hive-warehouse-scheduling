import type { Cell, GridConfig, StationConfig } from '@/sim/config';
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

/**
 * Maps a grid cell centre to world space. The grid is centred on the origin,
 * so the outermost cell centres sit half a cell inside the floor bounds.
 */
export function cellToWorld(
  cell: Cell,
  grid: GridConfig,
  cellSize = 1,
): { x: number; z: number } {
  return {
    x: (cell.x - (grid.width - 1) / 2) * cellSize,
    z: (cell.y - (grid.height - 1) / 2) * cellSize,
  };
}

/** Linear blend used to render one snapshot interval behind the worker. */
export function interpolate(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

/** Stable colour for a robot state, shared by the scene and the HUD legend. */
export function stateColor(status: RobotStatus): string {
  return STATE_COLORS[status];
}

/** Resolves a snapshot state byte to its status name. */
export function robotStatusFromCode(code: number): RobotStatus {
  return ROBOT_STATUS_ORDER[code] ?? 'idle';
}

/**
 * Places a station just outside the grid edge its docks sit on. Docks are
 * averaged to a centroid, then pushed one cell outward from the nearest edge.
 */
export function stationWorldPosition(
  station: StationConfig,
  grid: GridConfig,
  cellSize = 1,
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

  const offset = nearest.direction * cellSize;
  return nearest.axis === 'x'
    ? { x: base.x + offset, z: base.z }
    : { x: base.x, z: base.z + offset };
}
