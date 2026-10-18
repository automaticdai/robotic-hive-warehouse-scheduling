import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Allocator } from '../sim/allocation';
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
  strategy: string;
  strategyDigest: string;
  simDurationMs: number;
  wallTimeMs: number;
  metrics: MetricsSummary;
}

interface AllocatorHandle {
  allocator: Allocator;
  strategyDigest: string;
}

function createAllocator(strategy: string): AllocatorHandle {
  if (strategy === 'builtin:fcfs') {
    return { allocator: new FcfsAllocator(), strategyDigest: 'builtin' };
  }

  if (strategy.startsWith('python:')) {
    throw new Error(
      `Strategy "${strategy}" needs the Python sidecar client, which Task 9 adds; ` +
        'use "builtin:fcfs" until then.',
    );
  }

  throw new Error(`Unknown strategy "${strategy}" (supported: builtin:fcfs)`);
}

/**
 * Runs the simulation headlessly until `untilMs`, applying the configured
 * allocation strategy each time allocation is due, then writes the summary,
 * time series, and resolved configuration to `outDir`.
 */
export async function runHeadless(options: HeadlessOptions): Promise<HeadlessSummary> {
  const { allocator, strategyDigest } = createAllocator(options.strategy);
  const fallbackAllocator = new FcfsAllocator();

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

  const sim = new Simulation(config);
  const wallStart = performance.now();

  while (sim.timeMs < options.untilMs) {
    if (sim.isAllocationDue()) {
      const observation = sim.observe();
      const seq = observation.allocationSeq;
      try {
        // Allocators may answer synchronously or asynchronously (the Python
        // sidecar client in Task 9 is async).
        const assignments = await allocator.allocate(observation);
        sim.applyAllocation(seq, assignments);
      } catch {
        if (config.allocation.onFailure === 'fallback-fcfs') {
          sim.applyAllocation(seq, fallbackAllocator.allocate(observation));
        } else {
          sim.skipAllocation(seq);
        }
      }
    }

    sim.tick();
  }

  const wallTimeMs = Math.round(performance.now() - wallStart);
  const simDurationMs = sim.timeMs;
  const metrics = sim.getMetrics();

  const summary: HeadlessSummary = {
    config,
    seed: config.seed,
    strategy: options.strategy,
    strategyDigest,
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

  return summary;
}
