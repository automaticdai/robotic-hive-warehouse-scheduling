import type { Cell, GridConfig } from './config';
import type { Robot, World } from './types';
import { cellKey } from './world';

/** Manhattan distance between two grid cells. */
export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Neighbour offsets in deterministic scan order: N, E, S, W. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

function isInBounds(cell: Cell, grid: GridConfig): boolean {
  return cell.x >= 0 && cell.x < grid.width && cell.y >= 0 && cell.y < grid.height;
}

interface OpenNode {
  index: number;
  f: number;
}

function compareOpenNodes(a: OpenNode, b: OpenNode): number {
  if (a.f !== b.f) return a.f - b.f;
  return a.index - b.index;
}

/** Minimal binary min-heap ordered by f then cell index. */
class OpenSet {
  private readonly items: OpenNode[] = [];

  get size(): number {
    return this.items.length;
  }

  push(node: OpenNode): void {
    this.items.push(node);
    let child = this.items.length - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (compareOpenNodes(this.items[child]!, this.items[parent]!) >= 0) break;
      [this.items[child], this.items[parent]] = [this.items[parent]!, this.items[child]!];
      child = parent;
    }
  }

  pop(): OpenNode | undefined {
    const root = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last !== undefined) {
      this.items[0] = last;
      let parent = 0;
      for (;;) {
        const left = parent * 2 + 1;
        const right = left + 1;
        let smallest = parent;
        if (
          left < this.items.length &&
          compareOpenNodes(this.items[left]!, this.items[smallest]!) < 0
        ) {
          smallest = left;
        }
        if (
          right < this.items.length &&
          compareOpenNodes(this.items[right]!, this.items[smallest]!) < 0
        ) {
          smallest = right;
        }
        if (smallest === parent) break;
        [this.items[parent], this.items[smallest]] = [
          this.items[smallest]!,
          this.items[parent]!,
        ];
        parent = smallest;
      }
    }
    return root;
  }
}

/**
 * A* over the 4-neighbour grid. Entering a cell costs `1 + extraCost(cell)`.
 * The heuristic is Manhattan distance and ties are broken by cell index
 * (`y * width + x`), which keeps the result deterministic.
 *
 * Returns the cells after `start`, ending at `goal`; empty when the robot is
 * already at the goal or no path exists.
 */
export function findPath(
  grid: GridConfig,
  start: Cell,
  goal: Cell,
  extraCost: (cell: Cell) => number = () => 0,
): Cell[] {
  if (!isInBounds(start, grid) || !isInBounds(goal, grid)) return [];
  if (start.x === goal.x && start.y === goal.y) return [];

  const { width } = grid;
  const totalCells = grid.width * grid.height;
  const startIndex = start.y * width + start.x;
  const goalIndex = goal.y * width + goal.x;

  const gScore = new Float64Array(totalCells).fill(Number.POSITIVE_INFINITY);
  const cameFrom = new Int32Array(totalCells).fill(-1);
  const closed = new Uint8Array(totalCells);

  gScore[startIndex] = 0;
  const open = new OpenSet();
  open.push({ index: startIndex, f: manhattan(start, goal) });

  while (open.size > 0) {
    const current = open.pop()!;
    if (closed[current.index] !== 0) continue;
    if (current.index === goalIndex) break;
    closed[current.index] = 1;

    const currentX = current.index % width;
    const currentY = Math.floor(current.index / width);

    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const nextX = currentX + dx;
      const nextY = currentY + dy;
      if (nextX < 0 || nextX >= grid.width || nextY < 0 || nextY >= grid.height) continue;

      const nextIndex = nextY * width + nextX;
      if (closed[nextIndex] !== 0) continue;

      const nextCell = { x: nextX, y: nextY };
      const tentative = gScore[current.index]! + 1 + extraCost(nextCell);
      if (tentative >= gScore[nextIndex]!) continue;

      gScore[nextIndex] = tentative;
      cameFrom[nextIndex] = current.index;
      open.push({ index: nextIndex, f: tentative + manhattan(nextCell, goal) });
    }
  }

  if (cameFrom[goalIndex] === -1) return [];

  const pathIndices: number[] = [];
  let node = goalIndex;
  while (node !== startIndex) {
    pathIndices.push(node);
    const parent = cameFrom[node]!;
    if (parent === -1) return [];
    node = parent;
  }
  pathIndices.reverse();

  return pathIndices.map((index) => ({
    x: index % width,
    y: Math.floor(index / width),
  }));
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Rotates a cycle so its lexicographically smallest id comes first. */
function normalizeCycle(cycle: string[]): string[] {
  let firstIndex = 0;
  for (let index = 1; index < cycle.length; index++) {
    if (compareIds(cycle[index]!, cycle[firstIndex]!) < 0) firstIndex = index;
  }
  return [...cycle.slice(firstIndex), ...cycle.slice(0, firstIndex)];
}

/**
 * Finds cycles in the blocked-by relation. Each robot waits on at most one
 * other robot, so cycles are disjoint. Every cycle is returned once, rotated
 * to start at its smallest id, with cycles ordered by that id.
 */
export function detectWaitCycles(blockedBy: Map<string, string>): string[][] {
  const cycles: string[][] = [];
  const settled = new Set<string>();
  const starts = [...blockedBy.keys()].sort(compareIds);

  for (const start of starts) {
    if (settled.has(start)) continue;

    const chain: string[] = [];
    const positions = new Map<string, number>();
    let current: string | undefined = start;

    while (current !== undefined && !settled.has(current)) {
      const position = positions.get(current);
      if (position !== undefined) {
        cycles.push(normalizeCycle(chain.slice(position)));
        break;
      }
      positions.set(current, chain.length);
      chain.push(current);
      current = blockedBy.get(current);
    }

    for (const id of chain) settled.add(id);
  }

  cycles.sort((a, b) => compareIds(a[0]!, b[0]!));
  return cycles;
}

export interface MovementStats {
  moves: number;
  blocks: number;
  replans: number;
  deadlockEvents: number;
}

/** Ticks a robot may stay blocked before it recomputes its path. */
const MAX_CONSECUTIVE_BLOCKED_TICKS = 10;
/** Extra cost for entering a cell currently occupied by a robot. */
const OCCUPIED_CELL_EXTRA_COST = 3;
/** Extra cost for entering a cell another robot intends to enter. */
const CONTESTED_CELL_EXTRA_COST = 1;

function isCarrying(robot: Robot): boolean {
  return robot.carrying || robot.status === 'moving_loaded';
}

/**
 * Priority order: carrying robots first, then the older assignment, then the
 * lexicographically smaller id. Sorting ascending puts the highest priority
 * first, so the last element of a sorted group is the lowest priority.
 */
function comparePriority(a: Robot, b: Robot): number {
  const aPriority = isCarrying(a) ? 0 : 1;
  const bPriority = isCarrying(b) ? 0 : 1;
  if (aPriority !== bPriority) return aPriority - bPriority;
  if (a.assignedAtMs !== b.assignedAtMs) return a.assignedAtMs - b.assignedAtMs;
  return compareIds(a.id, b.id);
}

/**
 * Builds the congestion surcharge used when replanning: a cell holding another
 * robot costs 3 extra, and a cell that is another robot's intended next step
 * costs 1 extra. The replanning robot itself is ignored.
 */
function buildCongestionCost(robots: Robot[], excludedId: string): (cell: Cell) => number {
  const occupied = new Map<string, number>();
  const contested = new Map<string, number>();

  for (const robot of robots) {
    if (robot.id === excludedId) continue;

    const currentKey = cellKey(robot.cell);
    occupied.set(currentKey, (occupied.get(currentKey) ?? 0) + 1);

    if (robot.path.length > 0) {
      const nextKey = cellKey(robot.path[0]!);
      contested.set(nextKey, (contested.get(nextKey) ?? 0) + 1);
    }
  }

  return (cell) => {
    const key = cellKey(cell);
    return (
      (occupied.get(key) ?? 0) * OCCUPIED_CELL_EXTRA_COST +
      (contested.get(key) ?? 0) * CONTESTED_CELL_EXTRA_COST
    );
  };
}

/** Replans a robot from its current cell to the last cell of its current path. */
function replanToGoal(world: World, robot: Robot, stats: MovementStats): void {
  if (robot.path.length === 0) return;

  const goal = robot.path[robot.path.length - 1]!;
  robot.path = [];
  robot.path = findPath(
    world.config.grid,
    robot.cell,
    goal,
    buildCongestionCost(world.robots, robot.id),
  );
  stats.replans += 1;
}

/** Returns the first N/E/S/W neighbour that is in bounds and unoccupied. */
function findFreeNeighbour(
  cell: Cell,
  grid: GridConfig,
  occupancy: ReadonlyMap<string, string>,
): Cell | undefined {
  for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
    const candidate = { x: cell.x + dx, y: cell.y + dy };
    if (isInBounds(candidate, grid) && !occupancy.has(cellKey(candidate))) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Collects the undirected connected component of the blockedBy graph reachable
 * from `start`, so overlapping waits are treated as one blockage.
 */
function collectBlockedComponent(
  start: string,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
  const component = new Set<string>([start]);
  const pending = [start];

  while (pending.length > 0) {
    const id = pending.pop()!;
    const neighbours = adjacency.get(id);
    if (neighbours === undefined) continue;

    for (const neighbour of neighbours) {
      if (component.has(neighbour)) continue;
      component.add(neighbour);
      pending.push(neighbour);
    }
  }

  return component;
}

/**
 * Returns the lowest-priority eligible candidate with a free adjacent cell.
 * Candidates must already be sorted by ascending priority.
 */
function findSidestepper(
  candidates: readonly Robot[],
  grid: GridConfig,
  occupancy: ReadonlyMap<string, string>,
): { robot: Robot; cell: Cell } | undefined {
  for (let index = candidates.length - 1; index >= 0; index--) {
    const robot = candidates[index]!;
    if (robot.status === 'at_station' || robot.path.length === 0) continue;

    const cell = findFreeNeighbour(robot.cell, grid, occupancy);
    if (cell !== undefined) return { robot, cell };
  }
  return undefined;
}

/**
 * Resolves one tick of robot movement. Robots are processed in priority order
 * against a working occupancy built from robot cells (pods are never
 * obstacles), so a robot cannot enter a cell another robot already occupies.
 *
 * Robots with an empty path and robots at a station are left untouched; moving,
 * blocking, replanning and deadlock recovery are the only state changes here.
 */
export function updateMovement(world: World): MovementStats {
  const stats: MovementStats = { moves: 0, blocks: 0, replans: 0, deadlockEvents: 0 };
  const grid = world.config.grid;

  const occupancy = new Map<string, string>();
  for (const robot of world.robots) occupancy.set(cellKey(robot.cell), robot.id);

  const orderedRobots = [...world.robots].sort(comparePriority);
  const blockedThisTick: Robot[] = [];

  for (const robot of orderedRobots) {
    if (robot.status === 'at_station') continue;
    if (robot.path.length === 0) continue;

    const next = robot.path[0]!;
    if (isInBounds(next, grid) && !occupancy.has(cellKey(next))) {
      occupancy.delete(cellKey(robot.cell));
      robot.cell = { x: next.x, y: next.y };
      occupancy.set(cellKey(robot.cell), robot.id);
      robot.path.shift();
      robot.status = isCarrying(robot) ? 'moving_loaded' : 'moving_empty';
      robot.blockedTicks = 0;
      stats.moves += 1;
    } else {
      robot.blockedTicks += 1;
      robot.status = 'waiting';
      stats.blocks += 1;
      blockedThisTick.push(robot);

      if (robot.blockedTicks >= MAX_CONSECUTIVE_BLOCKED_TICKS) {
        replanToGoal(world, robot, stats);
        robot.blockedTicks = 0;
      }
    }
  }

  const robotsById = new Map(world.robots.map((robot) => [robot.id, robot]));
  const blockedBy = new Map<string, string>();
  for (const robot of blockedThisTick) {
    if (robot.path.length === 0) continue;

    const next = robot.path[0]!;
    if (!isInBounds(next, grid)) continue;

    const blockerId = occupancy.get(cellKey(next));
    if (blockerId !== undefined && blockerId !== robot.id) {
      blockedBy.set(robot.id, blockerId);
    }
  }

  const cycles = detectWaitCycles(blockedBy);
  const cycleMemberIds = new Set<string>();
  for (const cycle of cycles) {
    for (const id of cycle) cycleMemberIds.add(id);
  }

  // Cycles are recovered per undirected blocked component: a cycle whose
  // designated victim is boxed in can still be broken by another blocked robot
  // (typically a blocker or a robot queued behind one) that has a free cell.
  const adjacency = new Map<string, Set<string>>();
  const connect = (a: string, b: string): void => {
    let aEdges = adjacency.get(a);
    if (aEdges === undefined) {
      aEdges = new Set();
      adjacency.set(a, aEdges);
    }
    aEdges.add(b);

    let bEdges = adjacency.get(b);
    if (bEdges === undefined) {
      bEdges = new Set();
      adjacency.set(b, bEdges);
    }
    bEdges.add(a);
  };
  for (const [robotId, blockerId] of blockedBy) connect(robotId, blockerId);

  const resolvedComponents = new Set<string>();

  for (const cycle of cycles) {
    const anchor = cycle[0]!;
    if (resolvedComponents.has(anchor)) continue;

    const component = collectBlockedComponent(anchor, adjacency);
    for (const id of component) resolvedComponents.add(id);

    const members = [...component]
      .map((id) => robotsById.get(id))
      .filter((robot): robot is Robot => robot !== undefined)
      .sort(comparePriority);

    // R19: break the cycle itself first. A peripheral blocker that happens to
    // be lower priority can otherwise be sidestepped forever while the cycle
    // members stay put. Fall back to the whole component only when every cycle
    // member is boxed in.
    const cycleCandidates = members.filter((robot) => cycleMemberIds.has(robot.id));
    const choice =
      findSidestepper(cycleCandidates, grid, occupancy) ??
      findSidestepper(members, grid, occupancy);
    if (choice === undefined) continue;

    const { robot: sidestepper, cell: sidestepCell } = choice;

    const goal = sidestepper.path[sidestepper.path.length - 1]!;
    const vacatedKey = cellKey(sidestepper.cell);

    occupancy.delete(vacatedKey);
    sidestepper.cell = { x: sidestepCell.x, y: sidestepCell.y };
    occupancy.set(cellKey(sidestepper.cell), sidestepper.id);
    sidestepper.path = [];
    sidestepper.status = isCarrying(sidestepper) ? 'moving_loaded' : 'moving_empty';
    sidestepper.blockedTicks = 0;
    stats.moves += 1;
    stats.deadlockEvents += 1;

    // A sidestep exists to give up the vacated cell. Planning straight back
    // into it would recreate the same wait cycle on the next tick, so it is
    // treated as impassable for the recovery replan.
    const congestionCost = buildCongestionCost(world.robots, sidestepper.id);
    sidestepper.path = findPath(grid, sidestepper.cell, goal, (cell) =>
      cellKey(cell) === vacatedKey ? Number.POSITIVE_INFINITY : congestionCost(cell),
    );
    // In a one-cell-wide corridor the goal may be reachable only through the
    // vacated cell. Returning [] there would strand the robot permanently:
    // recovery skips empty-path robots and allocation only accepts idle ones.
    // Fall back to the unconstrained route whenever the robot is still off its
    // remembered goal.
    if (
      sidestepper.path.length === 0 &&
      (sidestepper.cell.x !== goal.x || sidestepper.cell.y !== goal.y)
    ) {
      sidestepper.path = findPath(grid, sidestepper.cell, goal, congestionCost);
    }
    stats.replans += 1;
  }

  return stats;
}

