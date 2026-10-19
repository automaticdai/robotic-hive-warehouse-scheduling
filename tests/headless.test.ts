import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseDuration, parseHeadlessArgs } from '@/headless/args';
import { runHeadless } from '@/headless/run';

test('parses durations', () => {
  expect(parseDuration('24h')).toBe(86_400_000);
  expect(parseDuration('90s')).toBe(90_000);
  expect(parseDuration('500ms')).toBe(500);
  expect(() => parseDuration('nope')).toThrow();
});

test('parses headless flags', () => {
  const args = parseHeadlessArgs([
    '--config', 'configs/smoke.json', '--strategy', 'python:auction',
    '--until', '1h', '--seed', '7', '--out', 'results/x',
  ]);
  expect(args).toEqual({
    configPath: 'configs/smoke.json', strategy: 'python:auction',
    untilMs: 3_600_000, seed: 7, outDir: 'results/x',
  });
});

test('runs a short scenario and writes all outputs', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'hive-'));
  const summary = await runHeadless({
    configPath: 'configs/smoke.json', strategy: 'builtin:fcfs',
    untilMs: 60_000, seed: 42, outDir,
  });
  expect(summary.simDurationMs).toBe(60_000);
  expect(summary.metrics.simTimeMs).toBe(60_000);
  const csv = await readFile(path.join(outDir, 'metrics.csv'), 'utf8');
  expect(csv.split('\n')[0]).toBe(
    'simTimeMs,ordersCompleted,jobsCompleted,throughputPerHour,utilisation,pendingJobs,avgQueueLength',
  );
  const written = JSON.parse(await readFile(path.join(outDir, 'summary.json'), 'utf8'));
  expect(written.seed).toBe(42);
});

test('same config, seed, and strategy produce identical metrics', async () => {
  const a = await runHeadless({ configPath: 'configs/smoke.json', strategy: 'builtin:fcfs', untilMs: 120_000, seed: 42, outDir: await mkdtemp(path.join(tmpdir(), 'hive-a-')) });
  const b = await runHeadless({ configPath: 'configs/smoke.json', strategy: 'builtin:fcfs', untilMs: 120_000, seed: 42, outDir: await mkdtemp(path.join(tmpdir(), 'hive-b-')) });
  expect(a.metrics).toEqual(b.metrics);
});

test('rejects unknown flags, missing flags, and missing values', () => {
  expect(() => parseHeadlessArgs(['--config', 'configs/smoke.json', '--until', '1h', '--bogus'])).toThrow();
  expect(() => parseHeadlessArgs(['--until', '1h'])).toThrow();
  expect(() => parseHeadlessArgs(['--config', 'configs/smoke.json'])).toThrow();
  expect(() => parseHeadlessArgs(['--config', 'configs/smoke.json', '--until'])).toThrow();
});

test('defaults the strategy and output directory', () => {
  const args = parseHeadlessArgs(['--config', 'configs/smoke.json', '--until', '30s']);
  expect(args.strategy).toBe('builtin:fcfs');
  expect(args.seed).toBeUndefined();
  expect(args.outDir.startsWith('results/')).toBe(true);
});

test('accepts only positive integer durations with ms/s/m/h suffixes', () => {
  expect(parseDuration('10m')).toBe(600_000);
  expect(() => parseDuration('0s')).toThrow();
  expect(() => parseDuration('-5s')).toThrow();
  expect(() => parseDuration('1.5h')).toThrow();
  expect(() => parseDuration('10')).toThrow();
});

test('records allocator failures and FCFS fallbacks in the summary', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'hive-failing-'));
  const warnings: string[] = [];
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });

  try {
    const summary = await runHeadless({
      configPath: 'configs/smoke.json',
      strategy: 'python:failing_fixture',
      untilMs: 5_000,
      seed: 42,
      outDir,
      allocatorOverride: {
        allocate() {
          throw new Error('allocator unavailable for test');
        },
      },
    });

    // The requested strategy remains recorded, but the effective allocator
    // and fallback counts make the substitution explicit.
    expect(summary.strategy).toBe('python:failing_fixture');
    expect(summary.strategyDigest).toBe('unavailable');
    expect(summary.allocationAttempts).toBeGreaterThan(0);
    expect(summary.allocatorFailures).toBe(summary.allocationAttempts);
    expect(summary.fallbackAllocations).toBe(summary.allocationAttempts);
    expect(summary.usedFallback).toBe(true);
    expect(summary.effectiveStrategy).toBe('fallback-fcfs');

    const written = JSON.parse(await readFile(path.join(outDir, 'summary.json'), 'utf8'));
    expect(written.strategy).toBe('python:failing_fixture');
    expect(written.effectiveStrategy).toBe('fallback-fcfs');
    expect(written.allocatorFailures).toBe(summary.allocatorFailures);
    expect(written.fallbackAllocations).toBe(summary.fallbackAllocations);
    expect(written.usedFallback).toBe(true);

    // One first-failure warning plus one end-of-run warning, not one per
    // allocation.
    expect(warnings.filter((line) => line.includes('allocator failed'))).toHaveLength(1);
    expect(
      warnings.some((line) => line.includes('WARNING') && line.includes('fell back to FCFS')),
    ).toBe(true);
  } finally {
    warnSpy.mockRestore();
  }
});

test('records all-failure wait runs as effectiveStrategy none', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hive-wait-'));
  const outDir = path.join(dir, 'out');
  const raw = JSON.parse(await readFile('configs/smoke.json', 'utf8'));
  raw.allocation = { ...raw.allocation, onFailure: 'wait' };
  const configPath = path.join(dir, 'wait.json');
  await writeFile(configPath, JSON.stringify(raw));

  const warnings: string[] = [];
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });

  try {
    const summary = await runHeadless({
      configPath,
      strategy: 'python:never_answers',
      untilMs: 5_000,
      seed: 42,
      outDir,
      allocatorOverride: {
        allocate() {
          throw new Error('allocator unavailable for test');
        },
      },
    });

    expect(summary.strategy).toBe('python:never_answers');
    expect(summary.allocationAttempts).toBeGreaterThan(0);
    expect(summary.allocatorFailures).toBe(summary.allocationAttempts);
    expect(summary.fallbackAllocations).toBe(0);
    expect(summary.usedFallback).toBe(false);
    // The allocator never answered and no fallback was applied, so the run
    // must not be presented as the requested strategy.
    expect(summary.effectiveStrategy).toBe('none');

    const written = JSON.parse(await readFile(path.join(outDir, 'summary.json'), 'utf8'));
    expect(written.strategy).toBe('python:never_answers');
    expect(written.effectiveStrategy).toBe('none');

    expect(warnings.filter((line) => line.includes('allocator failed'))).toHaveLength(1);
    expect(
      warnings.some(
        (line) =>
          line.includes('WARNING') &&
          line.includes('all') &&
          line.includes('allocation requests failed'),
      ),
    ).toBe(true);
  } finally {
    warnSpy.mockRestore();
  }
});

test('runs Python strategies through the sidecar', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'hive-python-'));
  const summary = await runHeadless({
    configPath: 'configs/smoke.json', strategy: 'python:auction',
    untilMs: 1_000, seed: 42, outDir,
  });
  expect(summary.simDurationMs).toBe(1_000);
  expect(summary.strategyDigest).toMatch(/^[0-9a-f]{64}$/);
  const written = JSON.parse(await readFile(path.join(outDir, 'summary.json'), 'utf8'));
  expect(written.strategy).toBe('python:auction');
});

test('rejects traversal in Python strategy ids without writing output', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'hive-invalid-'));
  await expect(
    runHeadless({
      configPath: 'configs/smoke.json', strategy: 'python:../hive_sim/protocol',
      untilMs: 1_000, seed: 42, outDir,
    }),
  ).rejects.toThrow(/Invalid Python strategy/);
  expect(await readdir(outDir)).toEqual([]);
});
