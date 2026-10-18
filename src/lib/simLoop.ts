import type { AllocationObservation, Allocator, Assignment } from '@/sim/allocation';
import { FcfsAllocator } from '@/sim/fcfs';
import type { Simulation, Snapshot } from '@/sim/simulation';

export interface SimLoopOptions {
  sim: Simulation;
  allocator: Allocator;
  tickMs: number;
  now?: () => number;
  onSnapshot?: (snapshot: Snapshot) => void;
  snapshotIntervalMs?: number;
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
 * callbacks through the internal promise chain.
 */
export class SimLoop {
  private readonly sim: Simulation;
  private readonly tickMs: number;
  private readonly now: () => number;
  private readonly onSnapshot: ((snapshot: Snapshot) => void) | undefined;
  private readonly snapshotIntervalMs: number;

  private allocator: Allocator;
  private lastNowMs: number;
  private tickBudget = 0;
  private speedMultiplier = 1;
  private isRunning = false;
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
    this.isRunning = true;
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.advanceTo(this.now());
    }, this.tickMs);
  }

  pause(): void {
    this.isRunning = false;
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
   * pending.
   */
  advanceTo(nowMs: number): Promise<void> {
    return this.enqueue(async () => {
      const delta = Math.max(0, nowMs - this.lastNowMs);
      this.lastNowMs = nowMs;
      this.tickBudget += (delta * this.speedMultiplier) / this.tickMs;

      while (this.tickBudget >= 1) {
        if (this.sim.isAllocationDue()) {
          // Allocation turns do not consume budget: the next iteration either
          // runs an allocation that has since become due or spends on ticks.
          await this.runAllocationTurn();
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
    let assignments: Assignment[];

    try {
      assignments = await this.allocator.allocate(observation);
    } catch {
      if (this.sim.world.config.allocation.onFailure === 'fallback-fcfs') {
        assignments = await this.runFallback(observation);
      } else {
        this.sim.skipAllocation(seq);
        return;
      }
    }

    // A stale result means another turn already resolved this sequence; there
    // is nothing to apply.
    this.sim.applyAllocation(seq, assignments);
  }

  private runFallback(observation: AllocationObservation): Promise<Assignment[]> {
    return Promise.resolve(new FcfsAllocator().allocate(observation));
  }

  private emitSnapshotIfDue(): void {
    if (this.onSnapshot === undefined) return;
    const now = this.now();
    if (now - this.lastSnapshotAtMs < this.snapshotIntervalMs) return;
    this.lastSnapshotAtMs = now;
    this.onSnapshot(this.sim.getSnapshot());
  }
}
