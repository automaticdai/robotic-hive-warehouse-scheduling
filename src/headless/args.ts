/** Selected options for a headless run. */
export interface HeadlessOptions {
  configPath: string;
  strategy: string;
  untilMs: number;
  seed?: number;
  outDir: string;
}

const DURATION_UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
};

const FLAGS = new Set(['--config', '--strategy', '--until', '--seed', '--out']);

/**
 * Parses a positive integer duration with an `ms`, `s`, `m`, or `h` suffix into
 * milliseconds. Anything else (including zero, fractions, signs, and unknown
 * units) throws.
 */
export function parseDuration(input: string): number {
  const match = /^(\d+)(ms|s|m|h)$/.exec(input);
  if (match === null) {
    throw new Error(
      `Invalid duration "${input}" (expected a positive integer with an ms, s, m, or h suffix)`,
    );
  }

  const value = Number(match[1]);
  if (value <= 0) {
    throw new Error(`Invalid duration "${input}" (duration must be positive)`);
  }

  const durationMs = value * DURATION_UNIT_MS[match[2]!]!;
  if (!Number.isSafeInteger(durationMs)) {
    throw new Error(`Invalid duration "${input}" (value is too large)`);
  }
  return durationMs;
}

/**
 * Parses CLI flags. `--config` and `--until` are required; `--strategy`
 * defaults to the built-in FCFS allocator; `--out` defaults to a fresh
 * timestamped directory under `results/`. Unknown flags and missing values are
 * rejected.
 */
export function parseHeadlessArgs(argv: string[]): HeadlessOptions {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (!FLAGS.has(flag)) {
      throw new Error(`Unknown flag "${flag}"`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    values.set(flag, value);
    index += 1;
  }

  const configPath = values.get('--config');
  if (configPath === undefined) {
    throw new Error('Missing required flag --config');
  }

  const until = values.get('--until');
  if (until === undefined) {
    throw new Error('Missing required flag --until');
  }

  let seed: number | undefined;
  const rawSeed = values.get('--seed');
  if (rawSeed !== undefined) {
    seed = Number(rawSeed);
    if (!Number.isInteger(seed)) {
      throw new Error(`Invalid --seed "${rawSeed}" (expected an integer)`);
    }
  }

  return {
    configPath,
    strategy: values.get('--strategy') ?? 'builtin:fcfs',
    untilMs: parseDuration(until),
    ...(seed === undefined ? {} : { seed }),
    outDir: values.get('--out') ?? `results/${Date.now()}`,
  };
}
