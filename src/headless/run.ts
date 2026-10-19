import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AllocatorError, createAllocator, pythonModuleName } from '../lib/allocator';
import { createAllocationFailureReporter } from '../lib/allocationHealth';
import { PythonAllocator } from '../lib/pythonAllocator';
import { getSidecarInfo, startPythonSidecar, stopPythonSidecar } from '../server/pythonSidecar';
import type { Allocator, Assignment } from '../sim/allocation';
import { parseConfig } from '../sim/config';
import type { SimConfig } from '../sim/config';
import { FcfsAllocator } from '../sim/fcfs';
import { toCsv } from '../sim/metrics';
import { Simulation } from '../sim/simulation';
import type { MetricsSummary } from '../sim/simulation';
import type { HeadlessOptions } from './args';

export interface HeadlessSummary {
  config: SimConfig;
  seed: number;
  /** Requested strategy id. Always the id passed on the command line. */
  strategy: string;
  strategyDigest: string;
  /**
   * Allocator that produced results. `fallback-fcfs` when any allocation fell
   * back, `none` when every allocation failed under the wait/skip policy and no
   * allocator result was ever applied, otherwise the requested strategy.
   */
  effectiveStrategy: string;
  /** Number of allocation boundaries reached during the run. */
  allocationAttempts: number;
  /** Allocation requests that threw or timed out. */
  allocatorFailures: number;
  /** Failures resolved by applying the FCFS fallback. */
  fallbackAllocations: number;
  /** True when at least one allocation fell back to FCFS. */
  usedFallback: boolean;
  simDurationMs: number;
  wallTimeMs: number;
  metrics: MetricsSummary;
}

export interface HeadlessRunOptions extends HeadlessOptions {
  /**
   * Test seam: use this allocator instead of the one built from `strategy`.
   * Production callers never set it.
   */
  allocatorOverride?: Allocator;
}

/**
 * Fingerprints the strategy source so results record what produced them. The
 * built-in allocator keeps its historical `builtin` digest; Python strategies
 * hash their module source and fall back to `unavailable` when it cannot be
 * read.
 */
async function computeStrategyDigest(strategy: string): Promise<string> {
  if (strategy === 'builtin:fcfs') return 'builtin';
  if (!strategy.startsWith('python:')) return 'unavailable';

  // Reject traversal and malformed names before touching the file system.
  const moduleName = pythonModuleName(strategy);
  const strategiesDir = path.resolve(process.cwd(), 'python', 'strategies');
  const filePath = path.resolve(strategiesDir, `${moduleName}.py`);

  if (!filePath.startsWith(`${strategiesDir}${path.sep}`)) {
    throw new AllocatorError(`Invalid Python strategy path: "${strategy}"`);
  }

  try {
    const source = await readFile(filePath);
    return createHash('sha256').update(source).digest('hex');
  } catch {
    return 'unavailable';
  }
}

/**
 * Offline stand-in for a Python allocator. Its synchronous throw feeds the
 * existing per-allocation failure policy, so `fallback-fcfs` or `wait` applies
 * exactly as it does for any allocator error.
 */
function unavailablePythonAllocator(): Allocator {
  return {
    allocate(): Assignment[] {
      throw new AllocatorError('Python sidecar is offline');
    },
  };
}

/**
 * Runs the simulation headlessly until `untilMs`, applying the configured
 * allocation strategy each time allocation is due, then writes the summary,
 * time series, and resolved configuration to `outDir`.
 */
export async function runHeadless(
  options: HeadlessRunOptions,
): Promise<HeadlessSummary> {
  const raw: unknown = JSON.parse(await readFile(options.configPath, 'utf8'));
  let input = raw;
  if (options.seed !== undefined && raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    input = { ...(raw as Record<string, unknown>), seed: options.seed };
  }

  const parsed = parseConfig(input);
  const config: SimConfig = {
    ...parsed,
    allocation: { ...parsed.allocation, strategy: options.strategy },
  };

  const strategyDigest = await computeStrategyDigest(options.strategy);
  const fallbackAllocator = new FcfsAllocator();

  const isPython = options.strategy.startsWith('python:');
  let startedSidecar = false;
  let pythonAllocator: PythonAllocator | null = null;

  try {
    let allocator: Allocator;
    if (options.allocatorOverride !== undefined) {
      allocator = options.allocatorOverride;
    } else if (isPython) {
      // Only stop the sidecar if this run is the one that brought it up; a
      // process-wide start (for example instrumentation) keeps it alive.
      startedSidecar = !getSidecarInfo().online;
      const sidecar = await startPythonSidecar();

      if (sidecar.online && sidecar.url !== null) {
        allocator = createAllocator(options.strategy, {
          pythonUrl: sidecar.url,
          timeoutMs: config.allocation.timeoutMs,
        });
        if (allocator instanceof PythonAllocator) pythonAllocator = allocator;
      } else {
        allocator = unavailablePythonAllocator();
      }
    } else {
      allocator = createAllocator(options.strategy, {
        pythonUrl: null,
        timeoutMs: config.allocation.timeoutMs,
      });
    }

    const sim = new Simulation(config);
    const wallStart = performance.now();
    const failureReporter = createAllocationFailureReporter('headless run');
    let allocationAttempts = 0;
    let allocatorFailures = 0;
    let fallbackAllocations = 0;

    while (sim.timeMs < options.untilMs) {
      if (sim.isAllocationDue()) {
        const observation = sim.observe();
        const seq = observation.allocationSeq;
        allocationAttempts += 1;

        let assignments: Assignment[] | null = null;
        try {
          // Allocators may answer synchronously or asynchronously (the Python
          // sidecar client is async).
          assignments = await allocator.allocate(observation);
          failureReporter.report(null, allocator);
        } catch (error) {
          allocatorFailures += 1;
          failureReporter.report(error, allocator);
          if (config.allocation.onFailure === 'fallback-fcfs') {
            fallbackAllocations += 1;
            assignments = fallbackAllocator.allocate(observation);
          } else {
            sim.skipAllocation(seq);
          }
        }

        // Contain an apply failure exactly as before: the sequence must never
        // wedge, and fallback-fcfs still runs rather than skipping.
        if (assignments !== null) {
          try {
            sim.applyAllocation(seq, assignments);
          } catch {
            if (config.allocation.onFailure === 'fallback-fcfs') {
              sim.applyAllocation(seq, fallbackAllocator.allocate(observation));
            } else {
              sim.skipAllocation(seq);
            }
          }
        }
      }

      sim.tick();
    }

    const wallTimeMs = Math.round(performance.now() - wallStart);
    const simDurationMs = sim.timeMs;
    const metrics = sim.getMetrics();

    const usedFallback = fallbackAllocations > 0;
    // Under wait/skip every failed allocation is skipped instead of falling
    // back, so `usedFallback` stays false even when the allocator never
    // answered. Report that case explicitly rather than claiming the run used
    // the requested strategy.
    const allFailed =
      allocationAttempts > 0 && allocatorFailures === allocationAttempts;
    const effectiveStrategy = usedFallback
      ? 'fallback-fcfs'
      : allFailed
        ? 'none'
        : options.strategy;
    const summary: HeadlessSummary = {
      config,
      seed: config.seed,
      strategy: options.strategy,
      strategyDigest,
      effectiveStrategy,
      allocationAttempts,
      allocatorFailures,
      fallbackAllocations,
      usedFallback,
      simDurationMs,
      wallTimeMs,
      metrics,
    };

    await mkdir(options.outDir, { recursive: true });
    await writeFile(
      path.join(options.outDir, 'summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    await writeFile(path.join(options.outDir, 'metrics.csv'), toCsv(sim.getTimeSeries()));
    await writeFile(
      path.join(options.outDir, 'config.resolved.json'),
      `${JSON.stringify(config, null, 2)}\n`,
    );

    const { p50, p95 } = metrics.completionTimeMs;
    const simHours = simDurationMs / 3_600_000;
    const wallSeconds = wallTimeMs / 1_000;
    const realTimeRatio = wallTimeMs > 0 ? simDurationMs / wallTimeMs : 0;

    console.log(`Orders completed: ${metrics.ordersCompleted}`);
    console.log(`Throughput: ${metrics.throughputPerHour.toFixed(1)}/h`);
    console.log(`Completion p50/p95: ${p50.toFixed(1)} / ${p95.toFixed(1)} ms`);
    console.log(`Utilisation: ${(metrics.utilisation.overall * 100).toFixed(1)}%`);
    console.log(
      `Sim: ${simHours.toFixed(2)} sim-hours in ${wallSeconds.toFixed(2)} wall-seconds ` +
        `(${realTimeRatio.toFixed(1)}× real time)`,
    );

    if (usedFallback) {
      console.warn(
        `[hive-sim] WARNING: ${fallbackAllocations} of ${allocationAttempts} allocations ` +
          `fell back to FCFS (${allocatorFailures} allocator failures). ` +
          `This run's metrics are not a pure "${options.strategy}" result; ` +
          `summary.json records effectiveStrategy="${summary.effectiveStrategy}".`,
      );
    } else if (allFailed) {
      console.warn(
        `[hive-sim] WARNING: all ${allocationAttempts} allocation requests failed ` +
          `(${allocatorFailures} allocator failures) and the configured ` +
          `"${config.allocation.onFailure}" policy skipped every allocation. ` +
          `This run's metrics are not a "${options.strategy}" result; ` +
          `summary.json records effectiveStrategy="none".`,
      );
    }

    return summary;
  } finally {
    if (pythonAllocator !== null) await pythonAllocator.dispose();
    if (startedSidecar) await stopPythonSidecar();
  }
}
