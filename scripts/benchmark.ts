import { readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import path from 'node:path';
import { runHeadless } from '../src/headless/run';
import type { HeadlessSummary } from '../src/headless/run';
import { parseConfig } from '../src/sim/config';
import type { SimConfig } from '../src/sim/config';

const DEFAULT_CONFIG_PATH = 'configs/default.json';
const DEFAULT_HOURS = 1;
const HOUR_MS = 3_600_000;
const DOCS_PATH = path.join('docs', 'benchmarks.md');

export interface BenchmarkOptions {
  hours: number;
}

/**
 * Parses benchmark flags. `--hours N` sets the simulated duration of each run
 * (default 1 hour). Every other argument is rejected so typos cannot silently
 * benchmark a different scenario.
 */
export function parseBenchmarkArgs(argv: string[]): BenchmarkOptions {
  let hours = DEFAULT_HOURS;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag !== '--hours') {
      throw new Error(`Unknown flag "${flag}" (supported: --hours)`);
    }

    const raw = argv[index + 1];
    if (raw === undefined || raw.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid --hours "${raw}" (expected a positive number)`);
    }
    if (!Number.isSafeInteger(Math.round(parsed * HOUR_MS))) {
      throw new Error(`Invalid --hours "${raw}" (value is too large)`);
    }

    hours = parsed;
    index += 1;
  }

  return { hours };
}

function formatDurationMs(ms: number): string {
  return `${(ms / HOUR_MS).toFixed(2)} h (${ms.toLocaleString('en-US')} ms)`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatRatio(simDurationMs: number, wallTimeMs: number): number {
  return wallTimeMs > 0 ? simDurationMs / wallTimeMs : 0;
}

function scenarioSection(config: SimConfig, configPath: string): string {
  const stations = config.stations
    .map(
      (station) =>
        `${station.id} docks ${JSON.stringify(
          station.docks.map((dock) => [dock.x, dock.y]),
        )}, queue ${station.queueCapacity}, service ${station.serviceTimeMs} ms`,
    )
    .join('; ');

  return [
    '## Scenario',
    '',
    '| Setting | Value |',
    '| --- | --- |',
    `| Config | \`${configPath}\` |`,
    `| Strategy | \`${config.allocation.strategy}\` |`,
    `| Seed | ${config.seed} |`,
    `| Grid | ${config.grid.width} × ${config.grid.height} |`,
    `| Robots | ${config.robots.toLocaleString('en-US')} |`,
    `| Pods | ${config.pods.count.toLocaleString('en-US')}, replenish delay ${config.pods.replenishDelayMs} ms |`,
    `| Stations | ${stations} |`,
    `| Orders | ${config.orders.arrivalRatePerHour}/h, ${config.orders.linesPerOrder.min}–${config.orders.linesPerOrder.max} lines per order, packing ${config.orders.packingTimeMs} ms |`,
    `| Allocation | every ${config.allocation.intervalMs} ms, timeout ${config.allocation.timeoutMs} ms, on failure \`${config.allocation.onFailure}\` |`,
    `| Movement tick | ${config.movement.tickMs} ms |`,
    '',
    'Resolved config:',
    '',
    '```json',
    JSON.stringify(config, null, 2),
    '```',
    '',
  ].join('\n');
}

function wallClockSection(
  warmup: HeadlessSummary,
  measured: HeadlessSummary,
  measuredRatio: number,
): string {
  const rows = (
    [
      ['Warm-up (discarded)', warmup],
      ['Measured', measured],
    ] as const
  ).map(([label, summary]) => {
    const ratio = formatRatio(summary.simDurationMs, summary.wallTimeMs);
    return `| ${label} | ${summary.wallTimeMs.toLocaleString('en-US')} | ${(
      summary.wallTimeMs / 1_000
    ).toFixed(2)} | ${summary.simDurationMs.toLocaleString('en-US')} | ${ratio.toFixed(2)} |`;
  });

  return [
    '## Wall-clock result',
    '',
    '| Run | Wall time (ms) | Wall time (s) | Sim duration (ms) | simHoursPerWallHour |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    `Measured \`simHoursPerWallHour\` = **${measuredRatio.toFixed(2)}**; target ≥ 1.0: **${
      measuredRatio >= 1 ? 'PASS' : 'FAIL'
    }**.`,
    '',
  ].join('\n');
}

function metricsSection(summary: HeadlessSummary): string {
  const { metrics } = summary;
  const { completionTimeMs, utilisation } = metrics;
  const stationRows = metrics.stations.map(
    (station) =>
      `| ${station.id} | ${formatPercent(station.busyFraction)} | ${station.avgQueueLength.toFixed(
        2,
      )} | ${station.maxQueueLength} |`,
  );

  return [
    '## Measured metrics',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Orders completed | ${metrics.ordersCompleted.toLocaleString('en-US')} |`,
    `| Jobs completed | ${metrics.jobsCompleted.toLocaleString('en-US')} |`,
    `| Jobs pending | ${metrics.jobsPending.toLocaleString('en-US')} |`,
    `| Throughput (cumulative) | ${metrics.throughputPerHour.toFixed(2)} orders/h |`,
    `| Throughput (trailing hour) | ${metrics.throughputWindowPerHour.toFixed(2)} orders/h |`,
    `| Completion mean | ${completionTimeMs.mean.toFixed(2)} ms |`,
    `| Completion p50 | ${completionTimeMs.p50.toFixed(2)} ms |`,
    `| Completion p90 | ${completionTimeMs.p90.toFixed(2)} ms |`,
    `| Completion p95 | ${completionTimeMs.p95.toFixed(2)} ms |`,
    `| Completion p99 | ${completionTimeMs.p99.toFixed(2)} ms |`,
    `| Completion max | ${completionTimeMs.max.toFixed(2)} ms |`,
    `| Utilisation (overall) | ${formatPercent(utilisation.overall)} |`,
    `| Utilisation idle | ${formatPercent(utilisation.idle)} |`,
    `| Utilisation moving empty | ${formatPercent(utilisation.movingEmpty)} |`,
    `| Utilisation moving loaded | ${formatPercent(utilisation.movingLoaded)} |`,
    `| Utilisation waiting | ${formatPercent(utilisation.waiting)} |`,
    `| Utilisation at station | ${formatPercent(utilisation.atStation)} |`,
    `| Rejected assignments | ${metrics.rejectedAssignments.toLocaleString('en-US')} |`,
    `| Deadlock events | ${metrics.deadlockEvents.toLocaleString('en-US')} |`,
    '',
    '### Station queue stats (measured run)',
    '',
    '| Station | Busy fraction | Average queue length | Max queue length |',
    '| --- | ---: | ---: | ---: |',
    ...stationRows,
    '',
  ].join('\n');
}

function renderDocument(
  generatedAt: Date,
  config: SimConfig,
  configPath: string,
  warmup: HeadlessSummary,
  measured: HeadlessSummary,
  measuredRatio: number,
  outputDirs: { warmup: string; measured: string },
): string {
  const cpu = cpus()[0]?.model ?? 'unknown';
  const memoryBytes = totalmem();

  return [
    '# Headless Benchmark',
    '',
    `Generated by \`npm run benchmark -- --hours ${
      measured.simDurationMs / HOUR_MS
    }\` on ${generatedAt.toISOString()}.`,
    '',
    '## Machine',
    '',
    '| | |',
    '| --- | --- |',
    `| CPU | ${cpu} |`,
    `| Total memory | ${(memoryBytes / 1024 ** 3).toFixed(2)} GiB (${memoryBytes.toLocaleString(
      'en-US',
    )} bytes) |`,
    `| Platform | ${platform()} ${release()} |`,
    `| Node | ${process.version} |`,
    '',
    scenarioSection(config, configPath),
    '## Protocol',
    '',
    '`runHeadless` is executed twice at the same simulated duration with the same config,',
    'strategy, and seed. The first run warms up the process and is discarded; the second',
    'run is measured. The outputs are written to distinct directories under the',
    'git-ignored `results/` tree:',
    '',
    `- warm-up: \`${outputDirs.warmup}\``,
    `- measured: \`${outputDirs.measured}\``,
    '',
    wallClockSection(warmup, measured, measuredRatio),
    metricsSection(measured),
    '## Browser check (outstanding)',
    '',
    'The browser target — 2,000 robots on a 100×100 grid rendering at ≥30 fps while the',
    'simulation advances at 1× — is a deferred manual check and was not measured by this',
    'headless benchmark. It remains an outstanding acceptance check; this document does',
    'not claim it was measured.',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const options = parseBenchmarkArgs(process.argv.slice(2));
  const configPath = DEFAULT_CONFIG_PATH;
  const untilMs = Math.round(options.hours * HOUR_MS);

  const raw: unknown = JSON.parse(await readFile(configPath, 'utf8'));
  const config = parseConfig(raw);
  const strategy = config.allocation.strategy;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDirs = {
    warmup: path.join('results', `benchmark-warmup-${stamp}`),
    measured: path.join('results', `benchmark-measured-${stamp}`),
  };

  console.log(`Machine: ${cpus()[0]?.model ?? 'unknown'}`);
  console.log(
    `Platform: ${platform()} ${release()}; Node ${process.version}; memory ${(totalmem() / 1024 ** 3).toFixed(2)} GiB`,
  );
  console.log(`Config: ${configPath} (${config.grid.width}x${config.grid.height}, ${config.robots} robots)`);
  console.log(`Strategy: ${strategy}; seed: ${config.seed}`);
  console.log(`Sim duration per run: ${formatDurationMs(untilMs)}`);

  console.log('\n[1/2] Warm-up run (discarded)...');
  const warmup = await runHeadless({
    configPath,
    strategy,
    untilMs,
    seed: config.seed,
    outDir: outputDirs.warmup,
  });

  console.log('\n[2/2] Measured run...');
  const measured = await runHeadless({
    configPath,
    strategy,
    untilMs,
    seed: config.seed,
    outDir: outputDirs.measured,
  });

  const measuredRatio = formatRatio(measured.simDurationMs, measured.wallTimeMs);
  const warmupRatio = formatRatio(warmup.simDurationMs, warmup.wallTimeMs);
  const { metrics } = measured;
  const { completionTimeMs, utilisation } = metrics;

  console.log('\nBenchmark results');
  console.log(`  Warm-up wall time: ${warmup.wallTimeMs.toLocaleString('en-US')} ms (${warmupRatio.toFixed(2)}x)`);
  console.log(`  Measured wall time: ${measured.wallTimeMs.toLocaleString('en-US')} ms`);
  console.log(`  Sim duration: ${measured.simDurationMs.toLocaleString('en-US')} ms`);
  console.log(`  simHoursPerWallHour: ${measuredRatio.toFixed(2)}`);
  console.log(`  Orders completed: ${metrics.ordersCompleted}`);
  console.log(`  Throughput: ${metrics.throughputPerHour.toFixed(2)} orders/h`);
  console.log(
    `  Completion p50/p95: ${completionTimeMs.p50.toFixed(1)} / ${completionTimeMs.p95.toFixed(1)} ms`,
  );
  console.log(`  Utilisation: ${formatPercent(utilisation.overall)}`);
  console.log(`  Rejected assignments: ${metrics.rejectedAssignments}`);
  console.log(`  Deadlock events: ${metrics.deadlockEvents}`);

  const document = renderDocument(
    new Date(),
    config,
    configPath,
    warmup,
    measured,
    measuredRatio,
    outputDirs,
  );
  await writeFile(DOCS_PATH, document);
  console.log(`\nWrote ${DOCS_PATH}`);

  if (measuredRatio < 1) {
    console.error(`\nFAIL: simHoursPerWallHour ${measuredRatio.toFixed(2)} is below 1.0`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
