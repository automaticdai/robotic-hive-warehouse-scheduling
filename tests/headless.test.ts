import { mkdtemp, readFile, readdir } from 'node:fs/promises';
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
