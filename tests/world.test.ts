import { parseConfig } from '@/sim/config';
import { cellKey } from '@/sim/world';
import { createWorld } from '@/sim/world';

const config = parseConfig({
  grid: { width: 10, height: 10 },
  robots: 5,
  pods: { count: 7 },
  stations: [{ id: 'S-1', docks: [[0, 5]], queueCapacity: 4, serviceTimeMs: 1000 }],
  seed: 42,
});

test('world placement is deterministic for a seed', () => {
  const a = createWorld(config);
  const b = createWorld(config);
  expect(a.robots.map((r) => r.cell)).toEqual(b.robots.map((r) => r.cell));
  expect(a.pods.map((p) => p.cell)).toEqual(b.pods.map((p) => p.cell));
});

test('robots and pods each occupy distinct cells', () => {
  const world = createWorld(config);
  expect(new Set(world.robots.map((r) => cellKey(r.cell))).size).toBe(5);
  expect(new Set(world.pods.map((p) => cellKey(p.cell))).size).toBe(7);
});
