/* eslint-disable @typescript-eslint/no-explicit-any */
import { encodeSnapshot, decodeSnapshotEvent } from '@/worker/protocol';

test('snapshot buffers survive a structured-clone-style round trip', () => {
  const snapshot = {
    timeMs: 1000,
    robotIds: ['R-0001'],
    robots: {
      x: new Float32Array([3]), y: new Float32Array([4]),
      state: new Uint8Array([1]), carrying: new Uint8Array([0]),
      battery: new Float32Array([1]),
    },
    pods: { x: new Float32Array([9]), y: new Float32Array([9]), visible: new Uint8Array([1]), state: new Uint8Array([0]) },
    stations: [{ id: 'S-1', queueLength: 1, capacity: 8, busy: true }],
    metrics: {} as any,
  };
  const encoded = encodeSnapshot(snapshot);
  const decoded = decodeSnapshotEvent({ type: 'snapshot', ...encoded } as any);
  expect(decoded.robotIds).toEqual(['R-0001']);
  expect(Array.from(decoded.robots.x)).toEqual([3]);
  expect(decoded.stations[0].queueLength).toBe(1);
});
