import type { Allocator } from '@/sim/allocation';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface AllocationFailureReporter {
  /**
   * Records the outcome of one allocation attempt. Warnings are emitted only
   * on the transition into failure for a given allocator and on recovery, so a
   * strategy that times out at every allocation cannot flood the console.
   */
  report(error: unknown | null, allocator: Allocator): void;
}

/**
 * Creates a per-caller reporter. The "once" state is keyed by allocator
 * identity, so a hot-swapped strategy gets its own first-failure/recovery
 * warnings.
 */
export function createAllocationFailureReporter(
  context: string,
): AllocationFailureReporter {
  let active: Allocator | null = null;
  let failing = false;

  return {
    report(error, allocator) {
      if (allocator !== active) {
        active = allocator;
        failing = false;
      }

      if (error !== null) {
        if (failing) return;
        failing = true;
        console.warn(
          `[hive-sim] ${context}: allocator failed; the configured allocation failure policy applies (${errorMessage(error)})`,
        );
        return;
      }

      if (failing) {
        failing = false;
        console.warn(`[hive-sim] ${context}: allocator recovered`);
      }
    },
  };
}
