import { createRng } from '@/sim/rng';

test('same seed produces the same sequence', () => {
  const a = createRng(42);
  const b = createRng(42);
  expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
});

test('different seeds differ and values stay in range', () => {
  expect(createRng(7).next()).not.toBe(createRng(8).next());
  const rng = createRng(1);
  for (let i = 0; i < 100; i++) {
    const value = rng.next();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
    expect(rng.int(6)).toBeGreaterThanOrEqual(0);
    expect(rng.int(6)).toBeLessThan(6);
  }
});
