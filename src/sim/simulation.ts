import { OrderGenerator } from './orders';
import type {
  AllocationObservation,
  ApplyResult,
  Assignment,
  JobObservation,
  RejectedAssignment,
  RobotObservation,
  StationObservation,
} from './allocation';
import type { Cell, SimConfig } from './config';
import { percentile } from './metrics';
import { findPath, manhattan, NEIGHBOUR_OFFSETS, updateMovement } from './movement';
import type {
  Job,
  MetricsSample,
  MetricsSummary,
  Order,
  Pod,
  Robot,
  RobotStatus,
  Station,
  World,
} from './types';
import { cellKey, createWorld } from './world';

export type { MetricsSample, MetricsSummary } from './types';

export interface Snapshot {
  timeMs: number;
  robotIds: string[];
  robots: {
    x: Float32Array;
    y: Float32Array;
    state: Uint8Array;
    carrying: Uint8Array;
    battery: Float32Array;
  };
  pods: { x: Float32Array; y: Float32Array; visible: Uint8Array };
  stations: { id: string; queueLength: number; capacity: number; busy: boolean }[];
  metrics: MetricsSummary;
}

/** Sim-time spacing between time-series samples. */
const SAMPLE_INTERVAL_MS = 1_000;

/** Numeric robot-state encoding used by snapshot consumers. */
const ROBOT_STATE_CODE: Record<RobotStatus, number> = {
  idle: 0,
  moving_empty: 1,
  moving_loaded: 2,
  waiting: 3,
  at_station: 4,
};

interface StationMetricsState {
  busyTimeMs: number;
  queueLengthSum: number;
  maxQueueLength: number;
}

function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

function nearestDock(station: Station, from: Cell): Cell {
  let best = station.docks[0]!;
  let bestDistance = manhattan(from, best);
  for (let index = 1; index < station.docks.length; index++) {
    const dock = station.docks[index]!;
    const distance = manhattan(from, dock);
    if (distance < bestDistance) {
      best = dock;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Deterministic simulation orchestrator. Owns the world and drives the tick
 * lifecycle (orders, stations, replenishment, traffic, path-end actions) plus
 * the allocation handshake.
 */
export class Simulation {
  readonly world: World;

  private readonly orderGenerator: OrderGenerator;
  private readonly podsById = new Map<string, Pod>();
  private readonly timeSeries: MetricsSample[] = [];

  private pendingAllocationSeq: number | null = null;
  private allocationSeq = 0;
  private nextAllocationAtMs = 0;
  private lastSampleAtMs = 0;

  private ordersCompleted = 0;
  private jobsCompleted = 0;
  private rejectedAssignments = 0;
  private deadlockEvents = 0;
  private parkingSeq = 0;

  private readonly robotStateTimeMs: Record<RobotStatus, number> = {
    idle: 0,
    moving_empty: 0,
    moving_loaded: 0,
    waiting: 0,
    at_station: 0,
  };
  private readonly robotStatusSeen = new Map<string, RobotStatus>();
  private readonly robotStatusSinceMs = new Map<string, number>();
  private readonly stationMetrics = new Map<string, StationMetricsState>();
  private stationTickCount = 0;

  constructor(config: SimConfig) {
    this.world = createWorld(config);
    for (const pod of this.world.pods) this.podsById.set(pod.id, pod);
    this.orderGenerator = new OrderGenerator(this.world, config.orders, this.world.rng);

    // R23: state-duration accounting starts at sim time 0.
    for (const robot of this.world.robots) {
      this.robotStatusSeen.set(robot.id, robot.status);
      this.robotStatusSinceMs.set(robot.id, 0);
    }
    for (const station of this.world.stations) {
      this.stationMetrics.set(station.id, {
        busyTimeMs: 0,
        queueLengthSum: 0,
        maxQueueLength: 0,
      });
    }
  }

  get timeMs(): number {
    return this.world.simTimeMs;
  }

  isAllocationDue(): boolean {
    return this.pendingAllocationSeq === null && this.world.simTimeMs >= this.nextAllocationAtMs;
  }

  observe(): AllocationObservation {
    if (this.pendingAllocationSeq !== null) {
      throw new Error('An allocation observation is already pending');
    }

    this.allocationSeq += 1;
    this.pendingAllocationSeq = this.allocationSeq;

    return {
      simTimeMs: this.world.simTimeMs,
      allocationSeq: this.allocationSeq,
      robots: this.world.robots.map(
        (robot): RobotObservation => ({
          id: robot.id,
          cell: { x: robot.cell.x, y: robot.cell.y },
          status: robot.status,
          battery: robot.battery,
          jobId: robot.jobId,
        }),
      ),
      jobs: [...this.world.jobs.values()]
        .filter((job) => job.status === 'ready')
        .map(
          (job): JobObservation => ({
            id: job.id,
            orderId: job.orderId,
            podId: job.podId,
            pickup: { x: job.pickup.x, y: job.pickup.y },
            candidateStations: [...job.candidateStations],
            priority: job.priority,
            createdAtMs: job.createdAtMs,
            dependsOn: [...job.dependsOn],
          }),
        ),
      stations: this.world.stations.map(
        (station): StationObservation => ({
          id: station.id,
          queueLength: station.queue.length,
          queueCapacity: station.queueCapacity,
          serviceTimeMs: station.serviceTimeMs,
          busy: station.serviceRemainingMs > 0,
          docks: station.docks.map((dock) => ({ x: dock.x, y: dock.y })),
        }),
      ),
    };
  }

  applyAllocation(seq: number, assignments: Assignment[]): ApplyResult {
    if (this.pendingAllocationSeq === null || seq !== this.pendingAllocationSeq) {
      return { accepted: 0, rejected: [], stale: true };
    }

    const rejected: RejectedAssignment[] = [];
    const acceptedJobs = new Set<string>();
    const acceptedRobots = new Set<string>();
    const robotsById = new Map(this.world.robots.map((robot) => [robot.id, robot]));
    const stationsById = new Map(this.world.stations.map((station) => [station.id, station]));
    let accepted = 0;

    const reject = (assignment: Assignment, reason: RejectedAssignment['reason']): void => {
      rejected.push({ assignment, reason });
    };

    for (const assignment of assignments) {
      const robot = robotsById.get(assignment.robotId);
      if (robot === undefined) {
        reject(assignment, 'unknown-robot');
        continue;
      }
      // Checked before the idle check: the first accepted entry has already
      // started this robot, and the batch reason should be the duplicate.
      if (acceptedRobots.has(robot.id)) {
        reject(assignment, 'duplicate-robot');
        continue;
      }
      if (robot.status !== 'idle' || robot.jobId !== null) {
        reject(assignment, 'robot-not-idle');
        continue;
      }

      const job = this.world.jobs.get(assignment.jobId);
      if (job === undefined) {
        reject(assignment, 'unknown-job');
        continue;
      }
      if (acceptedJobs.has(job.id)) {
        reject(assignment, 'duplicate-job');
        continue;
      }
      if (job.status !== 'ready') {
        reject(assignment, 'job-not-ready');
        continue;
      }

      const station = stationsById.get(assignment.stationId);
      if (station === undefined) {
        reject(assignment, 'unknown-station');
        continue;
      }

      const order = this.world.orders.get(job.orderId);
      // Ruling R3: a conflicting frozen station outranks the candidate check.
      if (order !== undefined && order.stationId !== null && order.stationId !== station.id) {
        reject(assignment, 'station-frozen');
        continue;
      }
      if (!job.candidateStations.includes(station.id)) {
        reject(assignment, 'station-not-candidate');
        continue;
      }

      this.accept(robot, job, station, order);
      accepted += 1;
      acceptedJobs.add(job.id);
      acceptedRobots.add(robot.id);
    }

    this.rejectedAssignments += rejected.length;
    this.pendingAllocationSeq = null;
    this.nextAllocationAtMs = this.world.simTimeMs + this.world.config.allocation.intervalMs;

    return { accepted, rejected, stale: false };
  }

  skipAllocation(seq: number): void {
    // Ruling R15: a stale sequence is a no-op.
    if (this.pendingAllocationSeq === null || seq !== this.pendingAllocationSeq) return;

    this.pendingAllocationSeq = null;
    this.nextAllocationAtMs = this.world.simTimeMs + this.world.config.allocation.intervalMs;
  }

  tick(): void {
    this.world.simTimeMs += this.world.config.movement.tickMs;
    this.world.tick += 1;

    this.orderGenerator.generateDueOrders();
    // Advance packing before service completion so an order whose final pod is
    // serviced this tick starts its full packing duration at this timestamp.
    this.advanceOrders();
    this.advanceStations();
    this.replenishPods();
    this.releaseDependentJobs();
    this.retryDeposits();

    const movement = updateMovement(this.world);
    this.deadlockEvents += movement.deadlockEvents;

    this.resolvePathEndActions();
    this.recordTickMetrics();
    this.sampleIfDue();
  }

  getMetrics(): MetricsSummary {
    return {
      simTimeMs: this.world.simTimeMs,
      ordersCompleted: this.ordersCompleted,
      jobsCompleted: this.jobsCompleted,
      throughputPerHour: this.throughputPerHour(),
      throughputWindowPerHour: this.throughputWindowPerHour(),
      completionTimeMs: this.completionTimeSummary(),
      utilisation: this.utilisationSummary(),
      jobsPending: this.pendingJobs(),
      rejectedAssignments: this.rejectedAssignments,
      deadlockEvents: this.deadlockEvents,
      stations: this.stationSummary(),
    };
  }

  getTimeSeries(): MetricsSample[] {
    return [...this.timeSeries];
  }

  getSnapshot(): Snapshot {
    const robots = this.world.robots;
    const pods = this.world.pods;
    const x = new Float32Array(robots.length);
    const y = new Float32Array(robots.length);
    const state = new Uint8Array(robots.length);
    const carrying = new Uint8Array(robots.length);
    const battery = new Float32Array(robots.length);

    for (let index = 0; index < robots.length; index++) {
      const robot = robots[index]!;
      x[index] = robot.cell.x;
      y[index] = robot.cell.y;
      state[index] = ROBOT_STATE_CODE[robot.status];
      carrying[index] = robot.carrying ? 1 : 0;
      battery[index] = robot.battery;
    }

    const podX = new Float32Array(pods.length);
    const podY = new Float32Array(pods.length);
    const visible = new Uint8Array(pods.length);
    for (let index = 0; index < pods.length; index++) {
      const pod = pods[index]!;
      podX[index] = pod.cell.x;
      podY[index] = pod.cell.y;
      visible[index] = pod.available ? 1 : 0;
    }

    return {
      timeMs: this.world.simTimeMs,
      robotIds: robots.map((robot) => robot.id),
      robots: { x, y, state, carrying, battery },
      pods: { x: podX, y: podY, visible },
      stations: this.world.stations.map((station) => ({
        id: station.id,
        queueLength: station.queue.length,
        capacity: station.queueCapacity,
        busy: station.serviceRemainingMs > 0,
      })),
      metrics: this.getMetrics(),
    };
  }

  private accept(robot: Robot, job: Job, station: Station, order: Order | undefined): void {
    robot.jobId = job.id;
    robot.status = 'moving_empty';
    robot.assignedAtMs = this.world.simTimeMs;
    robot.carrying = false;
    robot.blockedTicks = 0;
    robot.path = findPath(this.world.config.grid, robot.cell, job.pickup);

    job.status = 'assigned';
    job.stationId = station.id;
    job.robotId = robot.id;

    if (order !== undefined) {
      if (order.stationId === null) order.stationId = station.id;
      for (const jobId of order.jobIds) {
        if (jobId === job.id) continue;
        const other = this.world.jobs.get(jobId);
        if (other !== undefined && other.status === 'ready') {
          other.candidateStations = [station.id];
        }
      }
    }
  }

  private advanceStations(): void {
    const tickMs = this.world.config.movement.tickMs;

    for (const station of this.world.stations) {
      if (station.serviceRemainingMs > 0) {
        station.serviceRemainingMs -= tickMs;
        if (station.serviceRemainingMs <= 0) {
          station.serviceRemainingMs = 0;
          this.completeService(station);
        }
      }
      if (station.serviceRemainingMs === 0 && station.queue.length > 0) {
        station.serviceRemainingMs = station.serviceTimeMs;
      }
    }
  }

  private completeService(station: Station): void {
    const entry = station.queue.shift();
    if (entry === undefined) return;

    const pod = this.podsById.get(entry.podId);
    if (pod !== undefined) {
      pod.available = false;
      pod.replenishAtMs = this.world.simTimeMs + this.world.config.pods.replenishDelayMs;
      pod.reservedByJobId = null;
    }

    const order = this.world.orders.get(entry.orderId);
    if (order !== undefined) {
      order.podsServiced += 1;
      if (
        order.podsServiced === order.podsTotal &&
        order.packingRemainingMs === null &&
        order.completedAtMs === null
      ) {
        order.packingRemainingMs = this.world.config.orders.packingTimeMs;
      }
    }
  }

  private replenishPods(): void {
    const now = this.world.simTimeMs;
    const pending: Pod[] = [];
    for (const pod of this.world.pods) {
      if (pod.replenishAtMs !== null && pod.replenishAtMs <= now) pending.push(pod);
    }
    if (pending.length === 0) return;

    const robotCells = new Set<string>();
    for (const robot of this.world.robots) robotCells.add(cellKey(robot.cell));

    const visibleCells = new Set<string>();
    for (const pod of this.world.pods) {
      if (pod.available) visibleCells.add(cellKey(pod.cell));
    }

    const { width, height } = this.world.config.grid;
    for (const pod of pending) {
      const free: Cell[] = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const key = `${x},${y}`;
          if (robotCells.has(key) || visibleCells.has(key)) continue;
          free.push({ x, y });
        }
      }
      // No free cell: leave the pod pending and retry on the next tick.
      if (free.length === 0) continue;

      const cell = free[this.world.rng.int(free.length)]!;
      pod.cell = cell;
      pod.available = true;
      pod.reservedByJobId = null;
      pod.replenishAtMs = null;
      visibleCells.add(cellKey(cell));
    }
  }

  private releaseDependentJobs(): void {
    for (const job of this.world.jobs.values()) {
      if (job.status !== 'pending') continue;
      const ready = job.dependsOn.every(
        (dependencyId) => this.world.jobs.get(dependencyId)?.status === 'complete',
      );
      if (!ready) continue;

      job.status = 'ready';
      const order = this.world.orders.get(job.orderId);
      if (order !== undefined && order.stationId !== null) {
        job.candidateStations = [order.stationId];
      }
    }
  }

  private advanceOrders(): void {
    const tickMs = this.world.config.movement.tickMs;

    for (const order of this.world.orders.values()) {
      if (order.completedAtMs !== null || order.packingRemainingMs === null) continue;

      const remaining = order.packingRemainingMs - tickMs;
      if (remaining <= 0) {
        // A tick can overshoot the due time when packing is not a multiple of
        // tickMs; record the exact due timestamp rather than the tick boundary.
        order.completedAtMs = this.world.simTimeMs + remaining;
        order.packingRemainingMs = 0;
        this.ordersCompleted += 1;
      } else {
        order.packingRemainingMs = remaining;
      }
    }
  }

  private retryDeposits(): void {
    const stationsById = new Map(this.world.stations.map((station) => [station.id, station]));

    for (const robot of this.world.robots) {
      if (robot.status !== 'at_station') continue;

      const job = robot.jobId === null ? undefined : this.world.jobs.get(robot.jobId);
      const station = job === undefined ? undefined : this.resolveStation(job, stationsById);
      if (job === undefined || station === undefined) {
        // A robot parked without a depositable trip cannot make progress.
        robot.status = 'idle';
        robot.jobId = null;
        robot.carrying = false;
        robot.path = [];
        robot.blockedTicks = 0;
        continue;
      }

      this.attemptDeposit(robot, job, station);
    }
  }

  /**
   * The station frozen on the job, or the first existing candidate when a
   * fixture (or restored world) has a carrying robot without a station yet.
   */
  private resolveStation(job: Job, stationsById: Map<string, Station>): Station | undefined {
    let station = job.stationId === null ? undefined : stationsById.get(job.stationId);
    if (station === undefined) {
      for (const candidateId of job.candidateStations) {
        station = stationsById.get(candidateId);
        if (station !== undefined) break;
      }
      if (station !== undefined) job.stationId = station.id;
    }
    return station;
  }

  private resolvePathEndActions(): void {
    const stationsById = new Map(this.world.stations.map((station) => [station.id, station]));

    for (const robot of this.world.robots) {
      if (robot.status === 'at_station') continue;
      if (robot.jobId === null) continue;

      const job = this.world.jobs.get(robot.jobId);
      if (job === undefined || job.status === 'complete') continue;

      if (!robot.carrying) {
        if (job.status !== 'assigned') continue;
        if (robot.path.length > 0) continue;
        if (robot.status !== 'moving_empty' && robot.status !== 'waiting') continue;
        if (!sameCell(robot.cell, job.pickup)) continue;

        const pod = this.podsById.get(job.podId);
        // Ruling R14: hide the pod for the loaded leg; keep the reservation
        // until service clears it.
        if (pod !== undefined) pod.available = false;

        robot.carrying = true;
        robot.status = 'moving_loaded';
        robot.blockedTicks = 0;

        const station = this.resolveStation(job, stationsById);
        if (station === undefined) continue;

        const dock = nearestDock(station, robot.cell);
        robot.path = findPath(this.world.config.grid, robot.cell, dock);
      }

      // Ruling R20: any dock of the assigned station accepts the pod, even if
      // the robot was targeting a different (sibling) dock or still has path
      // left. Docks of other stations never accept it.
      if (robot.carrying) {
        const station = this.resolveStation(job, stationsById);
        if (station === undefined) continue;
        if (!station.docks.some((dock) => sameCell(dock, robot.cell))) continue;
        this.attemptDeposit(robot, job, station);
      }
    }
  }

  private attemptDeposit(robot: Robot, job: Job, station: Station): boolean {
    if (station.queue.length >= station.queueCapacity) {
      robot.status = 'at_station';
      return false;
    }

    const wasEmpty = station.queue.length === 0;
    station.queue.push({ podId: job.podId, orderId: job.orderId, jobId: job.id });

    const pod = this.podsById.get(job.podId);
    if (pod !== undefined) pod.available = false;

    job.status = 'complete';
    job.completedAtMs = this.world.simTimeMs;
    this.jobsCompleted += 1;

    robot.status = 'idle';
    robot.jobId = null;
    robot.carrying = false;
    robot.path = [];
    robot.blockedTicks = 0;

    // Leave the dock immediately. Idle robots left standing on dock cells are
    // never moved by allocation in time and eventually wall off the station:
    // with only a few docks per station, two parked robots plus the arriving
    // queue are enough to box them in permanently. Stepping off keeps the dock
    // available for the next loaded robot.
    this.stepOffDock(robot);
    // With ~1,600 orders/h the station approaches would otherwise accumulate
    // one parked robot per serviced trip until every neighbouring cell is
    // occupied. Give the serviced robot a deterministic route away from the
    // dock apron so it rejoins the idle pool elsewhere.
    this.assignParkingRoute(robot);

    if (wasEmpty) station.serviceRemainingMs = station.serviceTimeMs;
    return true;
  }

  /**
   * Moves a just-serviced robot to the first free N/E/S/W neighbour, if any.
   * Sibling dock cells are skipped: stepping onto another dock of the same
   * station would trade one blocked dock for another.
   */
  private stepOffDock(robot: Robot): void {
    const occupied = this.robotOccupancy(robot);
    const dockCells = new Set(
      this.world.stations.flatMap((station) => station.docks.map((dock) => cellKey(dock))),
    );

    const { width, height } = this.world.config.grid;
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const cell = { x: robot.cell.x + dx, y: robot.cell.y + dy };
      if (cell.x < 0 || cell.x >= width || cell.y < 0 || cell.y >= height) continue;
      if (dockCells.has(cellKey(cell))) continue;
      if (occupied.has(cellKey(cell))) continue;
      robot.cell = cell;
      return;
    }
  }

  /**
   * Sends a serviced, unassigned robot to a free cell outside the dock apron.
   * The route is planned with Manhattan A*, so the robot may pass through
   * occupied cells in the plan; the movement tick blocks it and replans until
   * the route is executed. Robots keep the `moving_empty` status while
   * repositioning, so allocation only reuses them once they have parked.
   */
  private assignParkingRoute(robot: Robot): void {
    const { width, height } = this.world.config.grid;
    const occupied = this.robotOccupancy(robot);
    const apron = Math.max(2, Math.floor(Math.min(width, height) / 8));
    const docks = this.world.stations.flatMap((station) => station.docks);

    const preferred: Cell[] = [];
    const fallback: Cell[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = { x, y };
        if (occupied.has(cellKey(cell))) continue;

        let nearDock = false;
        for (const dock of docks) {
          if (manhattan(cell, dock) <= apron) {
            nearDock = true;
            break;
          }
        }
        if (nearDock) fallback.push(cell);
        else preferred.push(cell);
      }
    }

    // Degraded fallback: on a very small or very crowded grid there may be no
    // free cell outside the dock apron. Parking inside the apron is preferred
    // to leaving the robot parked on the station approach, so the fallback pool
    // is used explicitly rather than silently routing into the apron. When
    // even the fallback is empty the robot stays where it is.
    const pool = preferred.length > 0 ? preferred : fallback;
    if (pool.length === 0) return;

    const target = pool[this.parkingSeq % pool.length]!;
    this.parkingSeq += 1;
    const path = findPath(this.world.config.grid, robot.cell, target);
    if (path.length === 0) return;

    robot.path = path;
    robot.status = 'moving_empty';
    robot.blockedTicks = 0;
  }

  /** Cells occupied by robots other than `self`. */
  private robotOccupancy(self: Robot): Set<string> {
    const occupied = new Set<string>();
    for (const robot of this.world.robots) {
      if (robot !== self) occupied.add(cellKey(robot.cell));
    }
    return occupied;
  }

  private sampleIfDue(): void {
    if (this.world.simTimeMs - this.lastSampleAtMs < SAMPLE_INTERVAL_MS) return;
    this.lastSampleAtMs = this.world.simTimeMs;
    this.timeSeries.push({
      simTimeMs: this.world.simTimeMs,
      ordersCompleted: this.ordersCompleted,
      jobsCompleted: this.jobsCompleted,
      throughputPerHour: this.throughputPerHour(),
      utilisation: this.utilisationSummary().overall,
      pendingJobs: this.pendingJobs(),
      avgQueueLength: this.avgQueueLength(),
    });
  }

  /**
   * R23: records robot state durations and station busy/queue metrics at the
   * end of each tick, at tick granularity.
   */
  private recordTickMetrics(): void {
    const now = this.world.simTimeMs;

    for (const robot of this.world.robots) {
      const previous = this.robotStatusSeen.get(robot.id);
      if (previous === undefined) {
        this.robotStatusSeen.set(robot.id, robot.status);
        this.robotStatusSinceMs.set(robot.id, now);
        continue;
      }
      if (previous === robot.status) continue;

      const since = this.robotStatusSinceMs.get(robot.id) ?? now;
      this.robotStateTimeMs[previous] += now - since;
      this.robotStatusSeen.set(robot.id, robot.status);
      this.robotStatusSinceMs.set(robot.id, now);
    }

    const tickMs = this.world.config.movement.tickMs;
    this.stationTickCount += 1;
    for (const station of this.world.stations) {
      const state = this.stationMetrics.get(station.id) ?? {
        busyTimeMs: 0,
        queueLengthSum: 0,
        maxQueueLength: 0,
      };
      this.stationMetrics.set(station.id, state);

      if (station.serviceRemainingMs > 0) state.busyTimeMs += tickMs;
      const queueLength = station.queue.length;
      state.queueLengthSum += queueLength;
      if (queueLength > state.maxQueueLength) state.maxQueueLength = queueLength;
    }
  }

  private utilisationSummary(): MetricsSummary['utilisation'] {
    const stateTimes: Record<RobotStatus, number> = { ...this.robotStateTimeMs };

    // Include the open segment for each robot without mutating the totals.
    for (const robot of this.world.robots) {
      const status = this.robotStatusSeen.get(robot.id) ?? robot.status;
      const since = this.robotStatusSinceMs.get(robot.id) ?? this.world.simTimeMs;
      stateTimes[status] += this.world.simTimeMs - since;
    }

    const totalRobotTimeMs = this.world.simTimeMs * this.world.robots.length;
    const share = (timeMs: number): number =>
      totalRobotTimeMs > 0 ? timeMs / totalRobotTimeMs : 0;
    const overall =
      totalRobotTimeMs > 0
        ? Math.min(1, Math.max(0, 1 - stateTimes.idle / totalRobotTimeMs))
        : 0;

    return {
      overall,
      idle: share(stateTimes.idle),
      movingEmpty: share(stateTimes.moving_empty),
      movingLoaded: share(stateTimes.moving_loaded),
      waiting: share(stateTimes.waiting),
      atStation: share(stateTimes.at_station),
    };
  }

  private completionTimeSummary(): MetricsSummary['completionTimeMs'] {
    const durations: number[] = [];
    let max = 0;
    let total = 0;
    for (const order of this.world.orders.values()) {
      if (order.completedAtMs === null) continue;
      const duration = order.completedAtMs - order.createdAtMs;
      durations.push(duration);
      total += duration;
      if (duration > max) max = duration;
    }
    if (durations.length === 0) {
      return { mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 };
    }
    return {
      mean: total / durations.length,
      p50: percentile(durations, 50),
      p90: percentile(durations, 90),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      max,
    };
  }

  /** Orders completed in the trailing simulated hour (bound exclusive). */
  private throughputWindowPerHour(): number {
    const windowStartMs = this.world.simTimeMs - 3_600_000;
    let count = 0;
    for (const order of this.world.orders.values()) {
      if (order.completedAtMs !== null && order.completedAtMs > windowStartMs) count += 1;
    }
    return count;
  }

  private stationSummary(): MetricsSummary['stations'] {
    return this.world.stations.map((station) => {
      const state = this.stationMetrics.get(station.id) ?? {
        busyTimeMs: 0,
        queueLengthSum: 0,
        maxQueueLength: 0,
      };
      return {
        id: station.id,
        busyFraction:
          this.world.simTimeMs > 0 ? state.busyTimeMs / this.world.simTimeMs : 0,
        avgQueueLength:
          this.stationTickCount > 0 ? state.queueLengthSum / this.stationTickCount : 0,
        maxQueueLength: state.maxQueueLength,
      };
    });
  }

  private pendingJobs(): number {
    let pending = 0;
    for (const job of this.world.jobs.values()) {
      if (job.status !== 'complete') pending += 1;
    }
    return pending;
  }

  private avgQueueLength(): number {
    if (this.world.stations.length === 0) return 0;
    let total = 0;
    for (const station of this.world.stations) total += station.queue.length;
    return total / this.world.stations.length;
  }

  private throughputPerHour(): number {
    if (this.world.simTimeMs <= 0) return 0;
    return this.ordersCompleted / (this.world.simTimeMs / 3_600_000);
  }
}
