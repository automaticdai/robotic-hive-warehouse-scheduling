import {
  cellToWorld,
  interpolate,
  interpolatedWorldPosition,
  stateColor,
} from '@/components/hive/render';
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

function robotSnapshot(cells: { x: number; y: number }[]): Snapshot {
  return {
    timeMs: 0,
    robotIds: cells.map((_, index) => `R-${index}`),
    robots: {
      x: new Float32Array(cells.map((cell) => cell.x)),
      y: new Float32Array(cells.map((cell) => cell.y)),
      state: new Uint8Array(cells.length),
      carrying: new Uint8Array(cells.length),
      battery: new Float32Array(cells.length),
    },
    pods: {
      x: new Float32Array(0),
      y: new Float32Array(0),
      visible: new Uint8Array(0),
    },
    stations: [],
    metrics: {} as Snapshot['metrics'],
  };
}

test('interpolated positions centre cell coordinates in world space', () => {
  const grid = { width: 100, height: 100 };
  const current = robotSnapshot([{ x: 2, y: 0 }]);

  expect(interpolatedWorldPosition(null, current, 1, 0, grid)).toEqual({
    x: -47.5,
    z: -49.5,
  });

  const previous = robotSnapshot([{ x: 0, y: 0 }]);
  const target = { x: 0, z: 0 };
  const result = interpolatedWorldPosition(previous, current, 0.5, 0, grid, target);
  expect(result).toBe(target);
  expect(result).toEqual({ x: -48.5, z: -49.5 });
});

test('a stationary robot at cell (0,0) maps to the centred floor corner', () => {
  const grid = { width: 100, height: 100 };
  const current = robotSnapshot([{ x: 0, y: 0 }]);
  expect(interpolatedWorldPosition(null, current, 1, 0, grid)).toEqual({
    x: -49.5,
    z: -49.5,
  });
});

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

test('snapshot source reports the receive interval', () => {
  const source = new SnapshotSource();
  expect(source.intervalMs()).toBe(0);

  source.push(snapshotAt(1000), 1000);
  expect(source.intervalMs()).toBe(0);

  source.push(snapshotAt(1050), 1050);
  expect(source.intervalMs()).toBe(50);
});

test('lagged sampling keeps interpolation inside the receive interval', () => {
  const source = new SnapshotSource();
  const first = snapshotAt(1000);
  const second = snapshotAt(1050);
  source.push(first, 1000);
  source.push(second, 1050);

  const lag = source.intervalMs();
  const middle = source.sample(1075 - lag);
  expect(middle?.previous).toBe(first);
  expect(middle?.current).toBe(second);
  expect(middle?.alpha).toBe(0.5);

  expect(source.sample(1049.9 - lag)?.alpha).toBeCloseTo(0, 3);
  expect(source.sample(1100 - lag)?.alpha).toBe(1);
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
