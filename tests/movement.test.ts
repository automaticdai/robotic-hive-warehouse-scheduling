import { detectWaitCycles, findPath, manhattan } from '@/sim/movement';
import { parseConfig } from '@/sim/config';
import { updateMovement } from '@/sim/movement';
import { cellKey, createWorld } from '@/sim/world';

test('path is 4-connected and ends at the goal', () => {
  const path = findPath({ width: 10, height: 10 }, { x: 0, y: 0 }, { x: 3, y: 2 });
  expect(path.at(-1)).toEqual({ x: 3, y: 2 });
  let previous = { x: 0, y: 0 };
  for (const cell of path) {
    expect(manhattan(previous, cell)).toBe(1);
    previous = cell;
  }
});

test('high extra cost is avoided when a detour exists', () => {
  const path = findPath(
    { width: 3, height: 3 },
    { x: 0, y: 1 },
    { x: 2, y: 1 },
    (cell) => (cell.x === 1 && cell.y === 1 ? 100 : 0),
  );
  expect(path).not.toContainEqual({ x: 1, y: 1 });
});

test('detects a two-robot wait cycle', () => {
  const cycles = detectWaitCycles(
    new Map([
      ['R-1', 'R-2'],
      ['R-2', 'R-1'],
    ]),
  );
  expect(cycles).toHaveLength(1);
  expect(cycles[0].sort()).toEqual(['R-1', 'R-2']);
});

function twoRobotWorld(mode: 'older' | 'carrying') {
  const world = createWorld(
    parseConfig({
      grid: { width: 5, height: 3 },
      robots: 2,
      pods: { count: 1 },
      stations: [{ id: 'S-1', docks: [[4, 1]], queueCapacity: 2, serviceTimeMs: 1000 }],
      seed: 1,
    }),
  );
  world.robots[0].cell = { x: 0, y: 0 };
  world.robots[0].path = [{ x: 1, y: 0 }];
  world.robots[0].status = 'moving_empty';
  world.robots[0].assignedAtMs = 5;
  world.robots[1].cell = { x: 2, y: 0 };
  world.robots[1].path = [{ x: 1, y: 0 }];
  world.robots[1].status = mode === 'carrying' ? 'moving_loaded' : 'moving_empty';
  world.robots[1].assignedAtMs = 10;
  return world;
}

test('the older assignment wins a contested cell', () => {
  const world = twoRobotWorld('older');
  updateMovement(world);
  const cells = world.robots.map((r) => cellKey(r.cell));
  expect(new Set(cells).size).toBe(2);
  expect(world.robots[0].cell).toEqual({ x: 1, y: 0 });
  expect(world.robots[1].cell).toEqual({ x: 2, y: 0 });
});

test('a carrying robot wins a contested cell over an older empty robot', () => {
  const world = twoRobotWorld('carrying');
  updateMovement(world);
  expect(world.robots[1].cell).toEqual({ x: 1, y: 0 });
  expect(world.robots[0].cell).toEqual({ x: 0, y: 0 });
  expect(world.robots[0].blockedTicks).toBe(1);
});

test('movement resolution is deterministic', () => {
  const a = twoRobotWorld('carrying');
  const b = twoRobotWorld('carrying');
  updateMovement(a);
  updateMovement(b);
  expect(a.robots.map((r) => [r.cell, r.status])).toEqual(
    b.robots.map((r) => [r.cell, r.status]),
  );
});

test('a robot replans after ten consecutive blocked ticks', () => {
  const world = createWorld(
    parseConfig({
      grid: { width: 5, height: 3 },
      robots: 2,
      pods: { count: 1 },
      stations: [{ id: 'S-1', docks: [[4, 2]], queueCapacity: 2, serviceTimeMs: 1000 }],
      seed: 1,
    }),
  );
  world.robots[0].cell = { x: 0, y: 0 };
  world.robots[0].path = [{ x: 1, y: 0 }, { x: 2, y: 0 }];
  world.robots[0].status = 'moving_empty';
  world.robots[1].cell = { x: 1, y: 0 };
  world.robots[1].path = [];
  world.robots[1].status = 'idle';

  for (let tick = 1; tick <= 9; tick++) {
    const stats = updateMovement(world);
    expect(stats.replans).toBe(0);
    expect(world.robots[0].blockedTicks).toBe(tick);
    expect(world.robots[0].path).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
  }

  const stats = updateMovement(world);
  expect(stats.replans).toBe(1);
  expect(world.robots[0].blockedTicks).toBe(0);
  expect(world.robots[0].status).toBe('waiting');
  expect(world.robots[0].path.at(-1)).toEqual({ x: 2, y: 0 });
  expect(world.robots[0].path).not.toContainEqual({ x: 1, y: 0 });
});

test('a wait cycle sidesteps the lowest-priority robot and preserves its goal', () => {
  const world = createWorld(
    parseConfig({
      grid: { width: 5, height: 3 },
      robots: 2,
      pods: { count: 1 },
      stations: [{ id: 'S-1', docks: [[4, 2]], queueCapacity: 2, serviceTimeMs: 1000 }],
      seed: 1,
    }),
  );
  world.robots[0].cell = { x: 1, y: 1 };
  world.robots[0].path = [{ x: 2, y: 1 }, { x: 3, y: 1 }];
  world.robots[0].status = 'moving_empty';
  world.robots[0].assignedAtMs = 0;
  world.robots[1].cell = { x: 2, y: 1 };
  world.robots[1].path = [{ x: 1, y: 1 }, { x: 0, y: 1 }];
  world.robots[1].status = 'moving_empty';
  world.robots[1].assignedAtMs = 0;

  const stats = updateMovement(world);

  expect(stats.blocks).toBe(2);
  expect(stats.moves).toBe(1);
  expect(stats.replans).toBe(1);
  expect(stats.deadlockEvents).toBe(1);
  expect(world.robots[1].cell).toEqual({ x: 2, y: 0 });
  expect(world.robots[1].status).toBe('moving_empty');
  expect(world.robots[1].path.at(-1)).toEqual({ x: 0, y: 1 });
  expect(world.robots[0].cell).toEqual({ x: 1, y: 1 });
});
