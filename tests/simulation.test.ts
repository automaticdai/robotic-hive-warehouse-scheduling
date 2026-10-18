import { parseConfig } from '@/sim/config';
import { FcfsAllocator } from '@/sim/fcfs';
import { Simulation } from '@/sim/simulation';

function makeSim() {
  return new Simulation(
    parseConfig({
      grid: { width: 10, height: 10 },
      robots: 2,
      pods: { count: 20 },
      stations: [{ id: 'S-1', docks: [[0, 5]], queueCapacity: 2, serviceTimeMs: 1000 }],
      seed: 3,
    }),
  );
}

function addJob(sim: Simulation, orderId = 'O-000001') {
  const id = `J-${String(sim.world.jobs.size + 1).padStart(7, '0')}`;
  if (!sim.world.orders.has(orderId)) {
    sim.world.orders.set(orderId, {
      id: orderId, createdAtMs: 0, jobIds: [], stationId: null,
      podsTotal: 0, podsServiced: 0, packingRemainingMs: null, completedAtMs: null,
    });
  }
  sim.world.orders.get(orderId)!.jobIds.push(id);
  sim.world.jobs.set(id, {
    id, orderId, podId: 'P-00001', pickup: { x: 5, y: 5 },
    candidateStations: ['S-1'], dependsOn: [], priority: 0,
    createdAtMs: 0, status: 'ready', stationId: null, robotId: null,
    completedAtMs: null,
  });
  return id;
}

test('accepts a valid assignment and starts the robot', () => {
  const sim = makeSim();
  sim.world.robots[0].status = 'idle';
  sim.world.robots[0].cell = { x: 0, y: 0 };
  const jobId = addJob(sim);
  const obs = sim.observe();
  const result = sim.applyAllocation(obs.allocationSeq, [
    { jobId, robotId: sim.world.robots[0].id, stationId: 'S-1' },
  ]);
  expect(result.accepted).toBe(1);
  expect(sim.world.robots[0].status).toBe('moving_empty');
  expect(sim.world.jobs.get(jobId)!.status).toBe('assigned');
});

test('rejects duplicate robots and leaves the second job ready', () => {
  const sim = makeSim();
  const robotId = sim.world.robots[0].id;
  const first = addJob(sim);
  const second = addJob(sim);
  const obs = sim.observe();
  const result = sim.applyAllocation(obs.allocationSeq, [
    { jobId: first, robotId, stationId: 'S-1' },
    { jobId: second, robotId, stationId: 'S-1' },
  ]);
  expect(result.accepted).toBe(1);
  expect(result.rejected.map((r) => r.reason)).toContain('duplicate-robot');
  expect(sim.world.jobs.get(second)!.status).toBe('ready');
});

test('rejects a station outside the job candidates', () => {
  const sim = makeSim();
  const jobId = addJob(sim);
  sim.world.stations.push({
    id: 'S-2', docks: [{ x: 9, y: 5 }], queueCapacity: 2,
    serviceTimeMs: 1000, queue: [], serviceRemainingMs: 0,
  });
  const obs = sim.observe();
  const result = sim.applyAllocation(obs.allocationSeq, [
    { jobId, robotId: sim.world.robots[0].id, stationId: 'S-2' },
  ]);
  expect(result.accepted).toBe(0);
  expect(result.rejected[0].reason).toBe('station-not-candidate');
});

test('a stale allocation response is ignored', () => {
  const sim = makeSim();
  const obs = sim.observe();
  sim.applyAllocation(obs.allocationSeq, []);
  const again = sim.applyAllocation(obs.allocationSeq, []);
  expect(again.stale).toBe(true);
  expect(again.accepted).toBe(0);
});

test('first accepted trip freezes the order station for later trips', () => {
  const sim = makeSim();
  sim.world.stations.push({
    id: 'S-2', docks: [{ x: 9, y: 5 }], queueCapacity: 2,
    serviceTimeMs: 1000, queue: [], serviceRemainingMs: 0,
  });
  const first = addJob(sim);
  const second = addJob(sim);
  sim.world.jobs.get(first)!.candidateStations = ['S-1', 'S-2'];
  sim.world.jobs.get(second)!.candidateStations = ['S-1', 'S-2'];
  const obs = sim.observe();
  const result = sim.applyAllocation(obs.allocationSeq, [
    { jobId: first, robotId: sim.world.robots[0].id, stationId: 'S-1' },
    { jobId: second, robotId: sim.world.robots[1].id, stationId: 'S-2' },
  ]);
  expect(result.accepted).toBe(1);
  expect(result.rejected[0].reason).toBe('station-frozen');
  expect(sim.world.jobs.get(second)!.candidateStations).toEqual(['S-1']);
});

test('robot waits at a full dock, then deposits when a slot frees', () => {
  const sim = makeSim();
  const station = sim.world.stations[0];
  station.queueCapacity = 1;
  sim.world.orders.set('O-000002', {
    id: 'O-000002', createdAtMs: 0, jobIds: [], stationId: 'S-1',
    podsTotal: 1, podsServiced: 0, packingRemainingMs: null, completedAtMs: null,
  });
  station.queue = [{ podId: 'P-00002', orderId: 'O-000002', jobId: 'J-0000002' }];
  station.serviceRemainingMs = 900;
  const jobId = addJob(sim);
  const robot = sim.world.robots[0];
  robot.cell = { x: 0, y: 5 };
  robot.jobId = jobId;
  robot.carrying = true;
  robot.status = 'moving_loaded';
  robot.path = [];
  sim.tick();
  expect(robot.status).toBe('at_station');
  for (let i = 0; i < 10; i++) sim.tick();
  expect(robot.status).toBe('idle');
  expect(sim.world.jobs.get(jobId)!.status).toBe('complete');
  expect(station.queue).toHaveLength(1);
});

// --- Ruled behaviour beyond the brief's tests ---

test('a frozen-order mismatch outranks the candidate-station check', () => {
  const sim = makeSim();
  sim.world.stations.push({
    id: 'S-2', docks: [{ x: 9, y: 5 }], queueCapacity: 2,
    serviceTimeMs: 1000, queue: [], serviceRemainingMs: 0,
  });
  const jobId = addJob(sim);
  sim.world.orders.get('O-000001')!.stationId = 'S-1';
  sim.world.jobs.get(jobId)!.candidateStations = ['S-2'];
  const obs = sim.observe();
  const result = sim.applyAllocation(obs.allocationSeq, [
    { jobId, robotId: sim.world.robots[0].id, stationId: 'S-2' },
  ]);
  expect(result.accepted).toBe(0);
  expect(result.rejected[0].reason).toBe('station-frozen');
});

test('deadlock events accumulate from updateMovement into the summary', () => {
  const sim = makeSim();
  const [a, b] = sim.world.robots;
  a.cell = { x: 1, y: 1 };
  a.path = [{ x: 2, y: 1 }, { x: 3, y: 1 }];
  a.status = 'moving_empty';
  a.assignedAtMs = 0;
  b.cell = { x: 2, y: 1 };
  b.path = [{ x: 1, y: 1 }, { x: 0, y: 1 }];
  b.status = 'moving_empty';
  b.assignedAtMs = 0;

  sim.tick();

  expect(sim.getMetrics().deadlockEvents).toBe(1);
});

test('picking up a pod hides it until service clears it', () => {
  const sim = makeSim();
  const jobId = addJob(sim);
  const robot = sim.world.robots[0];
  const pod = sim.world.pods[0];
  const job = sim.world.jobs.get(jobId)!;
  robot.cell = { x: 5, y: 5 };
  robot.status = 'moving_empty';
  robot.jobId = jobId;
  robot.carrying = false;
  robot.path = [];
  job.status = 'assigned';
  job.stationId = 'S-1';
  pod.cell = { x: 5, y: 5 };
  pod.available = true;
  pod.reservedByJobId = jobId;

  sim.tick();

  expect(robot.carrying).toBe(true);
  expect(robot.status).toBe('moving_loaded');
  expect(pod.available).toBe(false);
  expect(pod.reservedByJobId).toBe(jobId);
});

test('skipAllocation only clears the matching pending sequence', () => {
  const stale = makeSim();
  const first = stale.observe();
  stale.skipAllocation(first.allocationSeq + 1);
  expect(stale.applyAllocation(first.allocationSeq, []).stale).toBe(false);

  const skipped = makeSim();
  const second = skipped.observe();
  skipped.skipAllocation(second.allocationSeq);
  expect(skipped.applyAllocation(second.allocationSeq, []).stale).toBe(true);
});

test('observe throws while an allocation is pending', () => {
  const sim = makeSim();
  sim.observe();
  expect(() => sim.observe()).toThrow();
});

test('FCFS keeps completing jobs through persistent traffic', () => {
  const sim = new Simulation(
    parseConfig({
      grid: { width: 20, height: 20 },
      robots: 8,
      pods: { count: 100 },
      stations: [
        { id: 'S-1', docks: [[5, 5], [5, 6]], queueCapacity: 8, serviceTimeMs: 20000 },
        { id: 'S-2', docks: [[14, 10], [14, 11]], queueCapacity: 8, serviceTimeMs: 20000 },
      ],
      // Seed 5 freezes at 8 completed jobs with component-only recovery: the
      // 2-cycle members stay put while a lower-priority peripheral blocker is
      // sidestepped every tick.
      seed: 5,
    }),
  );
  const allocator = new FcfsAllocator();

  let jobsAt90s = 0;
  for (let tick = 1; tick <= 1800; tick++) {
    if (sim.isAllocationDue()) {
      const observation = sim.observe();
      sim.applyAllocation(observation.allocationSeq, allocator.allocate(observation));
    }
    sim.tick();
    if (tick === 900) jobsAt90s = sim.getMetrics().jobsCompleted;
  }

  const jobsAt180s = sim.getMetrics().jobsCompleted;
  expect(jobsAt180s).toBeGreaterThan(jobsAt90s);
});
