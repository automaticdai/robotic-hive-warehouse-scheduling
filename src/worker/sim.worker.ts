import type { Allocator } from '@/sim/allocation';
import type { SimConfig } from '@/sim/config';
import { Simulation } from '@/sim/simulation';
import type { Snapshot } from '@/sim/simulation';
import { createAllocator } from '@/lib/allocator';
import { createAllocationFailureReporter } from '@/lib/allocationHealth';
import { PythonAllocator } from '@/lib/pythonAllocator';
import { SimLoop } from '@/lib/simLoop';
import { encodeSnapshot } from './protocol';
import type {
  InspectionDetail,
  InspectionTarget,
  InitOptions,
  WorkerCommand,
  WorkerEvent,
} from './protocol';

/**
 * `tsconfig` targets the DOM library, which declares `self` as a Window. The
 * worker global shares the postMessage/onmessage surface but not the type, so
 * the scope is described structurally instead of adding a webworker lib
 * reference.
 */
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerCommand>) => void) | null;
  postMessage(message: WorkerEvent, transfer?: Transferable[]): void;
};

const STATUS_INTERVAL_MS = 200;
const INSPECTION_INTERVAL_MS = 200;
const SNAPSHOT_INTERVAL_MS = 50;
const HEALTH_PROBE_INTERVAL_MS = 2_000;
const HEALTH_PROBE_TIMEOUT_MS = 1_000;

let sim: Simulation | null = null;
let loop: SimLoop | null = null;
let allocator: Allocator | null = null;
let strategy = 'builtin:fcfs';
let pythonUrl: string | null = null;
let pythonOnline = false;
let inspectionTarget: InspectionTarget | null = null;
/**
 * Sticky init/select failure surfaced through status until a successful
 * init/select clears it.
 */
let startupFailure: string | null = null;
/**
 * Most recent allocation failure. Transient: the next successful allocation
 * clears it and immediately reports recovery.
 */
let allocationFailure: string | null = null;
const allocationReporter = createAllocationFailureReporter('live simulation');
/** Guards snapshots from loops that a later init/restart has superseded. */
let generation = 0;

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function sendReady(): void {
  if (sim === null) return;
  scope.postMessage({
    type: 'ready',
    robotIds: sim.world.robots.map((robot) => robot.id),
    stationIds: sim.world.stations.map((station) => station.id),
  });
}

function sendStatus(): void {
  if (sim === null || loop === null) return;
  scope.postMessage({
    type: 'status',
    running: loop.running,
    simTimeMs: sim.timeMs,
    effectiveSpeed: loop.effectiveSpeed,
    achievedSpeed: loop.achievedSpeed,
    strategy,
    pythonOnline,
    error: allocationFailure ?? startupFailure,
    metrics: sim.getMetrics(),
  });
}

function handleSnapshot(snapshot: Snapshot, loopGeneration: number): void {
  if (loopGeneration !== generation) return;
  const encoded = encodeSnapshot(snapshot);
  scope.postMessage(
    {
      type: 'snapshot',
      meta: encoded.meta,
      buffers: encoded.buffers,
      metrics: snapshot.metrics,
    },
    encoded.buffers,
  );
}

function describeRobot(id: string): InspectionDetail | null {
  if (sim === null) return null;
  const robot = sim.world.robots.find((candidate) => candidate.id === id);
  if (robot === undefined) return null;
  const job = robot.jobId === null ? undefined : sim.world.jobs.get(robot.jobId);

  return {
    type: 'robot',
    id: robot.id,
    state: robot.status,
    battery: robot.battery,
    jobId: robot.jobId,
    orderId: job?.orderId ?? null,
    stationId: job?.stationId ?? null,
    tripProgress: {
      pathRemaining: robot.path.length,
      carrying: robot.carrying,
    },
    cell: { x: robot.cell.x, y: robot.cell.y },
    path: robot.path.map((cell) => ({ x: cell.x, y: cell.y })),
    pickup: job === undefined ? null : { x: job.pickup.x, y: job.pickup.y },
  };
}

function describeStation(id: string): InspectionDetail | null {
  if (sim === null) return null;
  const station = sim.world.stations.find((candidate) => candidate.id === id);
  if (station === undefined) return null;

  return {
    type: 'station',
    id: station.id,
    queueLength: station.queue.length,
    queueCapacity: station.queueCapacity,
    busy: station.serviceRemainingMs > 0,
    serviceRemainingMs: station.serviceRemainingMs,
  };
}

function sendInspection(): void {
  const target = inspectionTarget;
  if (target === null || sim === null) return;
  const detail =
    target.type === 'robot' ? describeRobot(target.id) : describeStation(target.id);
  scope.postMessage({ type: 'inspection', target, detail });
}

function setInspectionTarget(target: InspectionTarget | null): void {
  inspectionTarget = target;
  // A cleared target is not echoed: the client resets its own inspector.
  if (target !== null) sendInspection();
}

async function probePythonHealth(): Promise<void> {
  const url = pythonUrl;
  if (url === null) {
    if (pythonOnline) {
      pythonOnline = false;
      sendStatus();
    }
    return;
  }

  let online = false;
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
    });
    online = response.ok;
  } catch {
    online = false;
  }

  // A probe started for a previous sidecar URL must not overwrite the badge.
  if (url !== pythonUrl) return;
  pythonOnline = online;
  sendStatus();
}

function handleAllocationResult(
  error: unknown | null,
  resultAllocator: Allocator,
): void {
  allocationReporter.report(error, resultAllocator);

  const hadFailure = allocationFailure !== null;
  allocationFailure = error === null ? null : errorMessage(error);

  if (allocationFailure !== null) {
    // Re-probe immediately: a request failure usually means the sidecar died.
    void probePythonHealth();
    sendStatus();
    return;
  }

  // Recovery is observable immediately instead of waiting for the next tick
  // of the periodic status interval; a stale error must not linger.
  if (hadFailure) sendStatus();
}

/**
 * Placeholder used when strategy construction fails during init. It always
 * throws so SimLoop applies the configured `allocation.onFailure` policy while
 * the worker stays alive and reports the error through status events.
 */
function createUnavailableAllocator(message: string): Allocator {
  return {
    allocate(): never {
      throw new Error(message);
    },
  };
}

function disposeAsync(target: Allocator | null): void {
  if (target instanceof PythonAllocator) {
    void target.dispose().catch(() => undefined);
  }
}

function buildLoop(
  nextSim: Simulation,
  nextAllocator: Allocator,
  loopGeneration: number,
): SimLoop {
  return new SimLoop({
    sim: nextSim,
    allocator: nextAllocator,
    tickMs: nextSim.world.config.movement.tickMs,
    onSnapshot: (snapshot) => handleSnapshot(snapshot, loopGeneration),
    snapshotIntervalMs: SNAPSHOT_INTERVAL_MS,
    onAllocationResult: (error, resultAllocator) => {
      // Discard results produced by a superseded configuration: an old loop
      // after init/restart, or a disposed allocator after selectStrategy. They
      // must not set sticky failures, re-probe health, or emit status.
      if (loopGeneration !== generation) return;
      if (resultAllocator !== allocator) return;
      handleAllocationResult(error, resultAllocator);
    },
  });
}

function init(config: SimConfig, options: InitOptions): void {
  // Build everything first so a constructor failure leaves the old run intact.
  const nextSim = new Simulation(config);
  let failure: string | null = null;
  let nextAllocator: Allocator;
  try {
    nextAllocator = createAllocator(options.strategy, {
      pythonUrl: options.pythonUrl,
      timeoutMs: config.allocation.timeoutMs,
    });
  } catch (caught) {
    failure = errorMessage(caught);
    console.warn(
      `[hive-sim] Failed to initialise allocator "${options.strategy}": ${failure}`,
    );
    nextAllocator = createUnavailableAllocator(failure);
  }

  const loopGeneration = ++generation;
  const nextLoop = buildLoop(nextSim, nextAllocator, loopGeneration);
  nextLoop.setSpeed(options.speed);

  loop?.pause();
  const previousAllocator = allocator;

  strategy = options.strategy;
  pythonUrl = options.pythonUrl;
  inspectionTarget = null;
  sim = nextSim;
  loop = nextLoop;
  allocator = nextAllocator;
  startupFailure = failure;
  allocationFailure = null;

  disposeAsync(previousAllocator);
  // A fresh worker starts paused; the client explicitly calls play().
  sendReady();
  sendStatus();
  void probePythonHealth();
}

function selectStrategy(nextStrategy: string): void {
  const currentSim = sim;
  if (currentSim === null) {
    // Nothing to configure yet; the next init supplies the timeout budget.
    strategy = nextStrategy;
    return;
  }

  // Validate the replacement before touching the running configuration.
  let nextAllocator: Allocator;
  try {
    nextAllocator = createAllocator(nextStrategy, {
      pythonUrl,
      timeoutMs: currentSim.world.config.allocation.timeoutMs,
    });
  } catch (caught) {
    // The previous allocator stays active; report both its identity and the
    // rejection so the UI can revert the optimistic option immediately.
    startupFailure = errorMessage(caught);
    console.warn(
      `[hive-sim] Strategy select failed for "${nextStrategy}": ${startupFailure}`,
    );
    sendStatus();
    return;
  }

  const previousAllocator = allocator;
  allocator = nextAllocator;
  strategy = nextStrategy;
  startupFailure = null;
  allocationFailure = null;
  loop?.setAllocator(nextAllocator);

  disposeAsync(previousAllocator);
  sendStatus();
  void probePythonHealth();
}

function restart(config: SimConfig): void {
  if (sim === null || loop === null) {
    init(config, { strategy, pythonUrl, speed: 1 });
    return;
  }

  // Build and validate the replacement first: on failure the current run (and
  // its running state) stays untouched.
  let nextSim: Simulation;
  let nextAllocator: Allocator;
  try {
    nextSim = new Simulation(config);
    nextAllocator = createAllocator(strategy, {
      pythonUrl,
      timeoutMs: config.allocation.timeoutMs,
    });
  } catch (caught) {
    startupFailure = errorMessage(caught);
    sendStatus();
    return;
  }

  const previousLoop = loop;
  const previousAllocator = allocator;
  const wasRunning = previousLoop.running;
  const speed = previousLoop.effectiveSpeed;

  const loopGeneration = ++generation;
  const nextLoop = buildLoop(nextSim, nextAllocator, loopGeneration);
  nextLoop.setSpeed(speed);

  previousLoop.pause();
  sim = nextSim;
  loop = nextLoop;
  allocator = nextAllocator;
  startupFailure = null;
  allocationFailure = null;

  if (wasRunning) nextLoop.start();

  disposeAsync(previousAllocator);
  sendReady();
  sendStatus();
  void probePythonHealth();
}

async function handleCommand(command: WorkerCommand): Promise<void> {
  switch (command.type) {
    case 'init':
      init(command.config, command.options);
      return;
    case 'play':
      loop?.start();
      sendStatus();
      return;
    case 'pause':
      loop?.pause();
      sendStatus();
      return;
    case 'step':
      await loop?.step();
      sendStatus();
      return;
    case 'setSpeed':
      loop?.setSpeed(command.speed);
      sendStatus();
      return;
    case 'selectStrategy':
      selectStrategy(command.strategy);
      return;
    case 'restart':
      restart(command.config);
      return;
    case 'inspect':
      setInspectionTarget(command.target);
      return;
  }
}

scope.onmessage = (event) => {
  // Command failures are reported through status but never tear the worker
  // down: the next command can recover.
  void handleCommand(event.data).catch((caught) => {
    startupFailure = errorMessage(caught);
    try {
      sendStatus();
    } catch {
      // Nothing further to report if the simulation itself is unavailable.
    }
  });
};

// Timers are created exactly once for the worker's lifetime and read the
// current module state, so init/restart cannot stack duplicate intervals.
setInterval(sendStatus, STATUS_INTERVAL_MS);
setInterval(sendInspection, INSPECTION_INTERVAL_MS);
setInterval(() => {
  if (pythonUrl !== null) void probePythonHealth();
}, HEALTH_PROBE_INTERVAL_MS);
