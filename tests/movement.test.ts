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

test('a blocked component sidesteps a free member when the cycle victim is boxed in', () => {
  const world = createWorld(
    parseConfig({
      grid: { width: 6, height: 5 },
      robots: 9,
      pods: { count: 1 },
      stations: [{ id: 'S-1', docks: [[5, 4]], queueCapacity: 2, serviceTimeMs: 1000 }],
      seed: 1,
    }),
  );
  const [r1, r2, r3, r4, r5, r6] = world.robots;

  // R1 <-> R2 wait cycle. R2 is the cycle's lowest-priority member and every
  // neighbour of R2 is covered by another member of the blocked component.
  r1.cell = { x: 2, y: 2 };
  r1.path = [{ x: 3, y: 2 }, { x: 3, y: 1 }];
  r1.status = 'moving_empty';
  r1.assignedAtMs = 0;

  r2.cell = { x: 3, y: 2 };
  r2.path = [{ x: 2, y: 2 }, { x: 2, y: 1 }];
  r2.status = 'moving_empty';
  r2.assignedAtMs = 0;

  r3.cell = { x: 3, y: 1 };
  r3.path = [{ x: 3, y: 2 }, { x: 4, y: 2 }];
  r3.status = 'moving_empty';
  r3.assignedAtMs = 0;

  r4.cell = { x: 4, y: 2 };
  r4.path = [{ x: 3, y: 2 }, { x: 3, y: 3 }];
  r4.status = 'moving_empty';
  r4.assignedAtMs = 0;

  // R5 is the component's lowest-priority member and has a free east neighbour.
  r5.cell = { x: 3, y: 3 };
  r5.path = [{ x: 3, y: 2 }, { x: 3, y: 1 }, { x: 4, y: 1 }];
  r5.status = 'moving_empty';
  r5.assignedAtMs = 10;

  // R6 is blocked by R5, so R5's sidestep frees R6's next cell.
  r6.cell = { x: 3, y: 4 };
  r6.path = [{ x: 3, y: 3 }, { x: 2, y: 3 }];
  r6.status = 'moving_empty';
  r6.assignedAtMs = 0;

  // Idle robots wall off R1's remaining neighbours, so neither cycle member has
  // a free cell and recovery must fall back to the whole component (R19).
  for (const [robot, cell] of [
    [world.robots[6], { x: 2, y: 1 }],
    [world.robots[7], { x: 2, y: 3 }],
    [world.robots[8], { x: 1, y: 2 }],
  ] as const) {
    robot.cell = cell;
    robot.path = [];
    robot.status = 'idle';
  }

  const first = updateMovement(world);

  expect(first.blocks).toBe(6);
  expect(first.moves).toBe(1);
  expect(first.replans).toBe(1);
  expect(first.deadlockEvents).toBe(1);
  expect(r5.cell).toEqual({ x: 4, y: 3 });
  expect(r5.path.at(-1)).toEqual({ x: 4, y: 1 });

  const second = updateMovement(world);

  expect(r6.cell).toEqual({ x: 3, y: 3 });
  expect(second.blocks).toBeLessThan(first.blocks);
});

test('a cycle member sidesteps before a lower-priority peripheral blocker', () => {
  const world = createWorld(
    parseConfig({
      grid: { width: 4, height: 4 },
      robots: 3,
      pods: { count: 1 },
      stations: [{ id: 'S-1', docks: [[3, 3]], queueCapacity: 2, serviceTimeMs: 1000 }],
      seed: 1,
    }),
  );
  const [boxed, cycleMover, peripheral] = world.robots;

  // R-0001 <-> R-0002 swap cycle. R-0001 is boxed in by the grid edge, the
  // peripheral blocker and R-0002; R-0002 has a free east neighbour.
  boxed.cell = { x: 0, y: 0 };
  boxed.path = [{ x: 1, y: 0 }, { x: 1, y: 1 }];
  boxed.status = 'moving_empty';
  boxed.assignedAtMs = 0;

  cycleMover.cell = { x: 1, y: 0 };
  cycleMover.path = [{ x: 0, y: 0 }, { x: 0, y: 1 }];
  cycleMover.status = 'moving_empty';
  cycleMover.assignedAtMs = 0;

  // The peripheral robot is blocked by R-0002, has a free neighbour of its own,
  // and has lower priority than both cycle members.
  peripheral.cell = { x: 0, y: 1 };
  peripheral.path = [{ x: 1, y: 0 }, { x: 1, y: 1 }];
  peripheral.status = 'moving_empty';
  peripheral.assignedAtMs = 10;

  const stats = updateMovement(world);

  expect(stats.blocks).toBe(3);
  expect(stats.moves).toBe(1);
  expect(stats.replans).toBe(1);
  expect(stats.deadlockEvents).toBe(1);
  expect(cycleMover.cell).toEqual({ x: 2, y: 0 });
  expect(peripheral.cell).toEqual({ x: 0, y: 1 });
  expect(boxed.cell).toEqual({ x: 0, y: 0 });
});
