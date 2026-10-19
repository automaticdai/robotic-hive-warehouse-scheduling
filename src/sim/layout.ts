import type { Cell, GridConfig, StationConfig } from './config';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutInput {
  grid: GridConfig;
  stations: readonly Pick<StationConfig, 'docks'>[];
  layout: { storage: Rect | null; portClearance: number };
}

/**
 * Storage block used when `layout.storage` is not configured: the whole grid,
 * inset by `portClearance` cells on every edge that carries a dock. This keeps
 * a pod-free port aisle along each station wall.
 */
export function defaultStorageRect(input: Omit<LayoutInput, 'layout'>, portClearance: number): Rect {
  const { width, height } = input.grid;
  const docks = input.stations.flatMap((station) => station.docks);
  const onEdge = (predicate: (dock: Cell) => boolean) => docks.some(predicate);

  const left = onEdge((dock) => dock.x === 0) ? portClearance : 0;
  const right = onEdge((dock) => dock.x === width - 1) ? portClearance : 0;
  const top = onEdge((dock) => dock.y === 0) ? portClearance : 0;
  const bottom = onEdge((dock) => dock.y === height - 1) ? portClearance : 0;

  return {
    x: left,
    y: top,
    width: Math.max(0, width - left - right),
    height: Math.max(0, height - top - bottom),
  };
}

export function storageRect(input: LayoutInput): Rect {
  return input.layout.storage ?? defaultStorageRect(input, input.layout.portClearance);
}

/**
 * Cells pods may occupy, in row-major order: inside the storage rectangle and
 * at least `portClearance` (Manhattan) cells from every dock. The distance
 * rule also clears a port zone around docks placed inside the storage block.
 */
export function storageCells(input: LayoutInput): Cell[] {
  const rect = storageRect(input);
  const { width, height } = input.grid;
  const clearance = input.layout.portClearance;
  const docks = input.stations.flatMap((station) => station.docks);

  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(width, rect.x + rect.width);
  const y1 = Math.min(height, rect.y + rect.height);

  const cells: Cell[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let nearDock = false;
      for (const dock of docks) {
        if (Math.abs(dock.x - x) + Math.abs(dock.y - y) < clearance) {
          nearDock = true;
          break;
        }
      }
      if (!nearDock) cells.push({ x, y });
    }
  }
  return cells;
}

/**
 * Home slots for `count` pods: the storage cells closest to the centre of the
 * storage rectangle (distance normalised by its width and height), so pods
 * form one compact block with the aspect of the storage area and the cells
 * left over around it become aisles. Ties break in row-major order, so the
 * result is deterministic and independent of the seed.
 */
export function podSlots(input: LayoutInput, count: number): Cell[] {
  const rect = storageRect(input);
  const cx = rect.x + (rect.width - 1) / 2;
  const cy = rect.y + (rect.height - 1) / 2;
  const sx = Math.max(1, rect.width);
  const sy = Math.max(1, rect.height);
  const ranked = storageCells(input).map((cell, order) => ({
    cell,
    order,
    distance: Math.max(Math.abs(cell.x - cx) / sx, Math.abs(cell.y - cy) / sy),
  }));
  ranked.sort((a, b) => a.distance - b.distance || a.order - b.order);
  return ranked.slice(0, count).map((entry) => entry.cell);
}

/** Bounding box of a set of cells, or null when there are none. */
export function boundingRect(cells: readonly Cell[]): Rect | null {
  if (cells.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const cell of cells) {
    if (cell.x < x0) x0 = cell.x;
    if (cell.y < y0) y0 = cell.y;
    if (cell.x > x1) x1 = cell.x;
    if (cell.y > y1) y1 = cell.y;
  }
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Radius (Manhattan cells) of the no-parking apron around every dock. Idle
 * robots are kept out of it: parked robots on a station approach get boxed in
 * by arriving loaded robots and wall the docks off for good.
 */
export function apronRadius(grid: GridConfig): number {
  return Math.max(2, Math.floor(Math.min(grid.width, grid.height) / 8));
}

/** Row-major flags (1 = inside the apron of some dock) for every grid cell. */
export function apronMask(input: Omit<LayoutInput, 'layout'>): Uint8Array {
  const { width, height } = input.grid;
  const radius = apronRadius(input.grid);
  const docks = input.stations.flatMap((station) => station.docks);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (const dock of docks) {
        if (Math.abs(dock.x - x) + Math.abs(dock.y - y) <= radius) {
          mask[y * width + x] = 1;
          break;
        }
      }
    }
  }
  return mask;
}
