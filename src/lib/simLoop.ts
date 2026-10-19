import type { Allocator, Assignment } from '@/sim/allocation';
import { FcfsAllocator } from '@/sim/fcfs';
import type { Simulation, Snapshot } from '@/sim/simulation';

export interface SimLoopOptions {
  sim: Simulation;
  allocator: Allocator;
  tickMs: number;
  now?: () => number;
  onSnapshot?: (snapshot: Snapshot) => void;
  snapshotIntervalMs?: number;
  onAllocationResult?: (error: unknown | null, allocator: Allocator) => void;
}

/** Default wall-clock spacing between snapshot callbacks. */
const DEFAULT_SNAPSHOT_INTERVAL_MS = 50;
const MIN_SPEED = 0.25;
const MAX_SPEED = 16;

/**
 * Wall-clock pacing loop around the deterministic simulation.
 *
 * `advanceTo` turns elapsed wall time into a tick budget (speed-scaled), then
 * runs ticks until the budget is spent. Allocation boundaries block the turn
 * until the allocator answers, which naturally serialises overlapping timer
 * callbacks through the internal promise chain. A pause epoch lets an in-flight
 * turn notice that it was paused and abandon the rest of its budget.
 */
export class SimLoop {
  private readonly sim: Simulation;
  private readonly tickMs: number;
  private readonly now: () => number;
  private readonly onSnapshot: ((snapshot: Snapshot) => void) | undefined;
  private readonly snapshotIntervalMs: number;
  private readonly onAllocationResult:
    | ((error: unknown | null, allocator: Allocator) => void)
    | undefined;

  private allocator: Allocator;
  private lastNowMs: number;
  private tickBudget = 0;
  private speedMultiplier = 1;
  private isRunning = false;
  private pauseEpoch = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshotAtMs = Number.NEGATIVE_INFINITY;
  private chain: Promise<void> = Promise.resolve();

  constructor(options: SimLoopOptions) {
    this.sim = options.sim;
    this.allocator = options.allocator;
    this.tickMs = options.tickMs;
    this.now = options.now ?? (() => Date.now());
    this.onSnapshot = options.onSnapshot;
    this.snapshotIntervalMs =
      options.snapshotIntervalMs ?? DEFAULT_SNAPSHOT_INTERVAL_MS;
    this.onAllocationResult = options.onAllocationResult;
    this.lastNowMs = this.now();
  }

  get running(): boolean {
    return this.isRunning;
  }

  /** The clamped multiplier currently used to convert wall time to ticks. */
  get effectiveSpeed(): number {
    return this.speedMultiplier;
  }

  start(): void {
    // A redundant start while running is a no-op: resetting the clock here
    // would silently discard elapsed time.
    if (this.isRunning) return;

    this.isRunning = true;
    // Resuming after a pause must not replay the paused wall-clock interval.
    this.lastNowMs = this.now();
    this.timer = setInterval(() => {
      void this.advanceTo(this.now());
    }, this.tickMs);
  }

  pause(): void {
    this.isRunning = false;
    // Invalidate turns that were queued (or are awaiting an allocator) before
    // this pause, and drop pacing accumulated for the interrupted turn.
    this.pauseEpoch += 1;
    this.tickBudget = 0;
    this.lastNowMs = this.now();
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setSpeed(multiplier: number): void {
    if (!Number.isFinite(multiplier)) {
      this.speedMultiplier = MIN_SPEED;
      return;
    }
    this.speedMultiplier = Math.min(MAX_SPEED, Math.max(MIN_SPEED, multiplier));
  }

  setAllocator(allocator: Allocator): void {
    this.allocator = allocator;
  }

  /**
   * Advances the simulation by the wall time since the previous turn. Turns are
   * serialised so a timer callback cannot re-enter while an allocation is
   * pending. The pause epoch is captured at call time: a turn queued before a
   * pause aborts without ticking once it gets to run.
   */
  advanceTo(nowMs: number): Promise<void> {
    const epoch = this.pauseEpoch;
    return this.enqueue(async () => {
      if (this.pauseEpoch !== epoch) return;

      const delta = Math.max(0, nowMs - this.lastNowMs);
      // Never move the clock backwards: a stale turn must not make the next
      // turn interpret the paused interval as elapsed time.
      this.lastNowMs = Math.max(this.lastNowMs, nowMs);
      this.tickBudget += (delta * this.speedMultiplier) / this.tickMs;

      while (this.tickBudget >= 1) {
        if (this.pauseEpoch !== epoch) return;

        if (this.sim.isAllocationDue()) {
          // Allocation turns do not consume budget: the next iteration either
          // runs an allocation that has since become due or spends on ticks.
          await this.runAllocationTurn();
          if (this.pauseEpoch !== epoch) return;
        } else {
          this.sim.tick();
          this.tickBudget -= 1;
        }
      }

      this.emitSnapshotIfDue();
    });
  }

  /** Works while paused: allocates if due, then advances exactly one tick. */
  step(): Promise<void> {
    return this.enqueue(async () => {
      this.lastNowMs = this.now();
      if (this.sim.isAllocationDue()) await this.runAllocationTurn();
      this.sim.tick();
      this.emitSnapshotIfDue();
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.chain.then(task);
    // Keep the chain usable after a failed turn without rethrowing to callers
    // that are not waiting on this particular turn.
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async runAllocationTurn(): Promise<void> {
    const observation = this.sim.observe();
    const seq = observation.allocationSeq;
    // Results are reported against the allocator that produced them so a
    // strategy swap can discard in-flight answers from the previous allocator.
    const attemptAllocator = this.allocator;
    let failure: unknown = null;

    try {
      let assignments: Assignment[];
      try {
        assignments = await attemptAllocator.allocate(observation);
      } catch (caught) {
        failure = caught;
        if (this.sim.world.config.allocation.onFailure !== 'fallback-fcfs') {
          this.sim.skipAllocation(seq);
          this.notifyAllocationResult(failure, attemptAllocator);
          return;
        }
        assignments = new FcfsAllocator().allocate(observation);
      }

      // A stale result means another turn already resolved this sequence; the
      // simulation ignores it, and the observation still counts as answered.
      this.sim.applyAllocation(seq, assignments);
      this.notifyAllocationResult(failure, attemptAllocator);
    } catch (caught) {
      // Fallback or apply failed after the observation was taken. Release the
      // pending sequence so the simulation can never wedge.
      try {
        this.sim.skipAllocation(seq);
      } catch {
        // The sequence was already resolved; nothing left to release.
      }
      this.notifyAllocationResult(caught, attemptAllocator);
    }
  }

  private notifyAllocationResult(
    error: unknown | null,
    allocator: Allocator,
  ): void {
    if (this.onAllocationResult === undefined) return;
    try {
      this.onAllocationResult(error, allocator);
    } catch {
      // Observers must not break the simulation loop.
    }
  }

  private emitSnapshotIfDue(): void {
    if (this.onSnapshot === undefined) return;
    const now = this.now();
    if (now - this.lastSnapshotAtMs < this.snapshotIntervalMs) return;
    this.lastSnapshotAtMs = now;
    this.onSnapshot(this.sim.getSnapshot());
  }
}
