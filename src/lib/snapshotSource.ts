import type { Snapshot } from '@/sim/simulation';

/** One interpolation step between the two most recent snapshots. */
export interface SnapshotSample {
  previous: Snapshot | null;
  current: Snapshot;
  alpha: number;
}

/**
 * Holds the last two snapshots received from the worker together with their
 * wall-clock receive times. Renderers sample this once per frame and blend
 * `previous` into `current`, which hides the gap between worker messages
 * without extrapolating past the newest snapshot.
 */
export class SnapshotSource {
  private currentSnapshot: Snapshot | null = null;
  private previousSnapshot: Snapshot | null = null;
  private currentAtMs: number | null = null;
  private previousAtMs: number | null = null;

  push(snapshot: Snapshot, receivedAtMs: number): void {
    this.previousSnapshot = this.currentSnapshot;
    this.previousAtMs = this.currentAtMs;
    this.currentSnapshot = snapshot;
    this.currentAtMs = receivedAtMs;
  }

  latest(): Snapshot | null {
    return this.currentSnapshot;
  }

  previous(): Snapshot | null {
    return this.previousSnapshot;
  }

  /**
   * Wall-clock span between the two most recent receives. Renderers subtract
   * this from the current time before sampling so they blend one interval
   * behind the worker and never race past the newest snapshot.
   */
  intervalMs(): number {
    if (this.currentAtMs === null || this.previousAtMs === null) return 0;
    return Math.max(0, this.currentAtMs - this.previousAtMs);
  }

  /**
   * Returns the blend state for `nowMs`. With one snapshot there is nothing to
   * blend, so alpha is 1; with two, alpha is the clamped fraction of the
   * receive interval that has elapsed. Sampling before the previous receive
   * clamps to 0 and after the current receive clamps to 1.
   */
  sample(nowMs: number): SnapshotSample | null {
    if (this.currentSnapshot === null || this.currentAtMs === null) return null;
    if (this.previousSnapshot === null || this.previousAtMs === null) {
      return { previous: null, current: this.currentSnapshot, alpha: 1 };
    }

    const interval = this.currentAtMs - this.previousAtMs;
    if (interval <= 0) {
      return { previous: this.previousSnapshot, current: this.currentSnapshot, alpha: 1 };
    }

    const elapsed = nowMs - this.previousAtMs;
    const alpha = Math.min(1, Math.max(0, elapsed / interval));
    return { previous: this.previousSnapshot, current: this.currentSnapshot, alpha };
  }
}
