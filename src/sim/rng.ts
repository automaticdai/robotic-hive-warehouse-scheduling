export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
}

/** Seeded mulberry32 PRNG. Deterministic for a given seed. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int(maxExclusive: number): number {
      return Math.floor(next() * maxExclusive);
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error('Rng.pick cannot pick from an empty array');
      }
      return items[Math.floor(next() * items.length)]!;
    },
  };
}
