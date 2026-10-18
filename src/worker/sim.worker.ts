import type { Allocator } from '@/sim/allocation';
import type { SimConfig } from '@/sim/config';
import { Simulation } from '@/sim/simulation';
import type { Snapshot } from '@/sim/simulation';
import { createAllocator } from '@/lib/allocator';
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

let sim: Simulation | null = null;
let loop: SimLoop | null = null;
let allocator: Allocator | null = null;
let strategy = 'builtin:fcfs';
let pythonUrl: string | null = null;
let inspectionTarget: InspectionTarget | null = null;
let error: string | null = null;
let statusTimer: ReturnType<typeof setInterval> | null = null;
let inspectionTimer: ReturnType<typeof setInterval> | null = null;

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
    pythonOnline: pythonUrl !== null,
    error,
    metrics: sim.getMetrics(),
  });
}

function handleSnapshot(snapshot: Snapshot): void {
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

function disposeAllocator(): void {
  if (allocator instanceof PythonAllocator) void allocator.dispose();
  allocator = null;
}

function startTimers(): void {
  if (statusTimer === null) {
    statusTimer = setInterval(sendStatus, STATUS_INTERVAL_MS);
  }
  if (inspectionTimer === null) {
    inspectionTimer = setInterval(sendInspection, INSPECTION_INTERVAL_MS);
  }
}

function createLoop(nextSim: Simulation, nextAllocator: Allocator): SimLoop {
  const nextLoop = new SimLoop({
    sim: nextSim,
    allocator: nextAllocator,
    tickMs: nextSim.world.config.movement.tickMs,
    onSnapshot: handleSnapshot,
    snapshotIntervalMs: SNAPSHOT_INTERVAL_MS,
  });
  sim = nextSim;
  return nextLoop;
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

function init(config: SimConfig, options: InitOptions): void {
  loop?.pause();
  disposeAllocator();

  strategy = options.strategy;
  pythonUrl = options.pythonUrl;
  inspectionTarget = null;
  error = null;

  // Build the simulation before the allocator: if strategy construction fails
  // the worker still reports metrics and readiness instead of going silent.
  const nextSim = new Simulation(config);
  let nextAllocator: Allocator;
  try {
    nextAllocator = createAllocator(strategy, {
      pythonUrl,
      timeoutMs: config.allocation.timeoutMs,
    });
  } catch (caught) {
    error = errorMessage(caught);
    nextAllocator = createUnavailableAllocator(error);
  }
  allocator = nextAllocator;

  loop = createLoop(nextSim, nextAllocator);
  loop.setSpeed(options.speed);
  // A fresh worker starts paused; the client explicitly calls play().
  startTimers();
  sendReady();
  sendStatus();
}

function selectStrategy(nextStrategy: string): void {
  const currentSim = sim;
  if (currentSim === null) {
    strategy = nextStrategy;
    return;
  }

  disposeAllocator();
  const nextAllocator = createAllocator(nextStrategy, {
    pythonUrl,
    timeoutMs: currentSim.world.config.allocation.timeoutMs,
  });

  allocator = nextAllocator;
  strategy = nextStrategy;
  loop?.setAllocator(nextAllocator);
  sendStatus();
}

function restart(config: SimConfig): void {
  if (sim === null || loop === null) {
    init(config, { strategy, pythonUrl, speed: 1 });
    return;
  }

  const wasRunning = loop.running;
  const speed = loop.effectiveSpeed;
  loop.pause();
  disposeAllocator();

  const nextSim = new Simulation(config);
  const nextAllocator = createAllocator(strategy, {
    pythonUrl,
    timeoutMs: config.allocation.timeoutMs,
  });
  allocator = nextAllocator;

  loop = createLoop(nextSim, nextAllocator);
  loop.setSpeed(speed);
  if (wasRunning) loop.start();

  sendReady();
  sendStatus();
}

async function handleCommand(command: WorkerCommand): Promise<void> {
  error = null;

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
    error = errorMessage(caught);
    try {
      sendStatus();
    } catch {
      // Nothing further to report if the simulation itself is unavailable.
    }
  });
};
