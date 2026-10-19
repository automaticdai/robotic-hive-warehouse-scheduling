import { cellToWorld, interpolate, stateColor } from '@/components/hive/render';
import { SnapshotSource } from '@/lib/snapshotSource';
import type { Snapshot } from '@/sim/simulation';

test('cell centres map to a centred world', () => {
  expect(cellToWorld({ x: 0, y: 0 }, { width: 100, height: 100 })).toEqual({ x: -49.5, z: -49.5 });
  expect(cellToWorld({ x: 99, y: 99 }, { width: 100, height: 100 })).toEqual({ x: 49.5, z: 49.5 });
});

test('interpolates linearly', () => {
  expect(interpolate(1, 3, 0.25)).toBe(1.5);
});

test('state colours are stable', () => {
  expect(stateColor('idle')).toBe('#5f7d8c');
  expect(stateColor('waiting')).toBe('#c0442f');
});

function snapshotAt(timeMs: number): Snapshot {
  return { timeMs } as Snapshot;
}

test('snapshot source keeps the latest two snapshots', () => {
  const source = new SnapshotSource();
  expect(source.latest()).toBeNull();
  expect(source.previous()).toBeNull();

  const first = snapshotAt(1000);
  const second = snapshotAt(1050);
  source.push(first, 1000);
  expect(source.latest()).toBe(first);
  expect(source.previous()).toBeNull();

  source.push(second, 1050);
  expect(source.latest()).toBe(second);
  expect(source.previous()).toBe(first);
});

test('snapshot source interpolates between the last two receive times', () => {
  const source = new SnapshotSource();
  const first = snapshotAt(1000);
  const second = snapshotAt(1050);
  source.push(first, 1000);
  source.push(second, 1050);

  const middle = source.sample(1025);
  expect(middle).not.toBeNull();
  expect(middle?.previous).toBe(first);
  expect(middle?.current).toBe(second);
  expect(middle?.alpha).toBe(0.5);

  expect(source.sample(900)?.alpha).toBe(0);
  expect(source.sample(2000)?.alpha).toBe(1);
});

test('snapshot source samples a lone snapshot with alpha 1', () => {
  const source = new SnapshotSource();
  const only = snapshotAt(1000);
  source.push(only, 1000);

  const sample = source.sample(0);
  expect(sample).toEqual({ previous: null, current: only, alpha: 1 });
});

test('snapshot source samples nothing when empty', () => {
  const source = new SnapshotSource();
  expect(source.sample(0)).toBeNull();
});
