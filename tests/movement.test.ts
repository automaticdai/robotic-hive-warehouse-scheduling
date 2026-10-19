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
  // An at-station robot is never pushed aside, so the blocker stays put and
  // the mover must replan (an idle blocker would now yield instead).
  world.robots[1].cell = { x: 1, y: 0 };
  world.robots[1].path = [];
  world.robots[1].status = 'at_station';

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

function movementWorld(robotCount: number, width = 5, height = 3) {
  return createWorld(
    parseConfig({
      grid: { width, height },
      robots: robotCount,
      pods: { count: 1 },
      stations: [{ id: 'S-1', docks: [[width - 1, height - 1]], queueCapacity: 2, serviceTimeMs: 1000 }],
      seed: 1,
    }),
  );
}

test('a moving robot pushes a parked idle blocker aside and advances', () => {
  const setup = (world: ReturnType<typeof movementWorld>): void => {
    const [mover, idle] = world.robots;
    mover.cell = { x: 1, y: 1 };
    mover.path = [{ x: 2, y: 1 }];
    mover.status = 'moving_empty';
    mover.jobId = 'J-0000001';
    mover.assignedAtMs = 0;

    idle.cell = { x: 2, y: 1 };
    idle.path = [];
    idle.status = 'idle';
    idle.jobId = null;
    idle.carrying = false;
  };

  const world = movementWorld(2);
  setup(world);
  const stats = updateMovement(world);

  expect(stats.blocks).toBe(0);
  expect(stats.moves).toBe(2);
  // Deterministic N/E/S/W order picks the north neighbour for the idle robot.
  expect(world.robots[1]!.cell).toEqual({ x: 2, y: 0 });
  expect(world.robots[0]!.cell).toEqual({ x: 2, y: 1 });
  // The yielded robot remains idle and unassigned.
  expect(world.robots[1]!.status).toBe('idle');
  expect(world.robots[1]!.jobId).toBeNull();
  expect(world.robots[1]!.path).toEqual([]);

  const repeat = movementWorld(2);
  setup(repeat);
  updateMovement(repeat);
  expect(repeat.robots.map((robot) => [robot.cell, robot.status])).toEqual(
    world.robots.map((robot) => [robot.cell, robot.status]),
  );
});

test('an idle robot nudged aside is not moved a second time in the same tick', () => {
  // X is parked at (1,1). A pushes X north to (1,0) and advances. B then wants
  // (1,0): X is still idle and unassigned, but it was already relocated this
  // phase, so B must wait instead of shoving X on to (0,0).
  const world = movementWorld(3);
  const [idle, first, second] = world.robots;

  idle.cell = { x: 1, y: 1 };
  idle.path = [];
  idle.status = 'idle';
  idle.jobId = null;
  idle.assignedAtMs = 100;

  first.cell = { x: 0, y: 1 };
  first.path = [{ x: 1, y: 1 }];
  first.status = 'moving_empty';
  first.jobId = 'J-0000001';
  first.assignedAtMs = 0;

  second.cell = { x: 2, y: 0 };
  second.path = [{ x: 1, y: 0 }];
  second.status = 'moving_empty';
  second.jobId = 'J-0000002';
  second.assignedAtMs = 10;

  const stats = updateMovement(world);

  expect(stats.moves).toBe(2);
  expect(stats.blocks).toBe(1);
  expect(idle.cell).toEqual({ x: 1, y: 0 });
  expect(idle.status).toBe('idle');
  expect(idle.jobId).toBeNull();
  expect(first.cell).toEqual({ x: 1, y: 1 });
  expect(second.cell).toEqual({ x: 2, y: 0 });
});

test('a boxed-in idle robot is not moved and the mover waits', () => {
  const world = movementWorld(5, 3, 3);
  const [mover, idle, north, east, south] = world.robots;

  mover.cell = { x: 0, y: 1 };
  mover.path = [{ x: 1, y: 1 }];
  mover.status = 'moving_empty';
  mover.jobId = 'J-0000001';

  idle.cell = { x: 1, y: 1 };
  idle.path = [];
  idle.status = 'idle';
  idle.jobId = null;

  // Every neighbour of the idle robot except the mover's own cell is occupied.
  for (const [robot, cell] of [
    [north!, { x: 1, y: 0 }],
    [east!, { x: 2, y: 1 }],
    [south!, { x: 1, y: 2 }],
  ] as const) {
    robot.cell = cell;
    robot.path = [];
    robot.status = 'at_station';
    robot.jobId = null;
  }

  const stats = updateMovement(world);

  expect(stats.moves).toBe(0);
  expect(stats.blocks).toBe(1);
  expect(idle.cell).toEqual({ x: 1, y: 1 });
  expect(idle.status).toBe('idle');
  expect(mover.cell).toEqual({ x: 0, y: 1 });
});

test('at_station, carrying, and assigned robots are never pushed aside', () => {
  const scenarios: Array<{ name: string; configure: (robot: ReturnType<typeof movementWorld>['robots'][number]) => void }> = [
    {
      name: 'at_station',
      configure: (robot) => {
        robot.status = 'at_station';
        robot.jobId = null;
        robot.path = [];
      },
    },
    {
      name: 'carrying',
      configure: (robot) => {
        robot.status = 'moving_loaded';
        robot.carrying = true;
        robot.jobId = 'J-0000002';
        robot.path = [];
      },
    },
    {
      name: 'assigned',
      configure: (robot) => {
        robot.status = 'idle';
        robot.jobId = 'J-0000002';
        robot.path = [];
      },
    },
  ];

  for (const scenario of scenarios) {
    const world = movementWorld(2);
    const [mover, blocker] = world.robots;
    mover.cell = { x: 0, y: 0 };
    mover.path = [{ x: 1, y: 0 }];
    mover.status = 'moving_empty';
    mover.jobId = 'J-0000001';

    blocker.cell = { x: 1, y: 0 };
    blocker.carrying = false;
    scenario.configure(blocker);

    const stats = updateMovement(world);

    expect(stats.moves, scenario.name).toBe(0);
    expect(stats.blocks, scenario.name).toBe(1);
    expect(blocker.cell, scenario.name).toEqual({ x: 1, y: 0 });
    expect(mover.cell, scenario.name).toEqual({ x: 0, y: 0 });
  }
});

test('recovery replans without the vacated-cell exclusion when it would strand the robot', () => {
  const world = createWorld(
    parseConfig({
      grid: { width: 1, height: 4 },
      robots: 2,
      pods: { count: 1 },
      stations: [{ id: 'S-1', docks: [[0, 3]], queueCapacity: 2, serviceTimeMs: 1000 }],
      seed: 1,
    }),
  );
  const [first, second] = world.robots;

  // A head-on swap in a one-cell-wide corridor. The lower-priority robot is
  // sidestepped south to the dead end at (0, 3), so its only route back to the
  // goal (0, 1) passes through the vacated cell (0, 2).
  first.cell = { x: 0, y: 1 };
  first.path = [{ x: 0, y: 2 }];
  first.status = 'moving_empty';
  first.jobId = 'J-0000001';
  first.assignedAtMs = 0;

  second.cell = { x: 0, y: 2 };
  second.path = [{ x: 0, y: 1 }];
  second.status = 'moving_empty';
  second.jobId = 'J-0000002';
  second.assignedAtMs = 10;

  const goals = new Map([
    [first.id, { x: 0, y: 2 }],
    [second.id, { x: 0, y: 1 }],
  ]);

  const stats = updateMovement(world);

  expect(stats.deadlockEvents).toBe(1);
  expect(second.cell).toEqual({ x: 0, y: 3 });
  // Without the fallback the exclusion-only replan returns [] and the robot is
  // permanently skipped by findSidestepper and by allocation (not idle).
  expect(second.path.length).toBeGreaterThan(0);
  expect(second.path.at(-1)).toEqual({ x: 0, y: 1 });

  for (let tick = 0; tick < 20; tick++) {
    updateMovement(world);
    for (const robot of world.robots) {
      const goal = goals.get(robot.id)!;
      const parkedAtGoal =
        robot.path.length > 0 || (robot.cell.x === goal.x && robot.cell.y === goal.y);
      expect(parkedAtGoal).toBe(true);
    }
  }
});
