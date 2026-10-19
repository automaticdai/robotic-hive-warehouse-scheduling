'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Object3D, type InstancedMesh } from 'three';
import type { SnapshotSource } from '@/lib/snapshotSource';
import type { SimConfig } from '@/sim/config';
import { POD_STATE_CODE } from '@/sim/types';
import { cellToWorldInto, FLOOR_PALETTE, type WorldPosition } from './render';

export interface PodInstancesProps {
  source: SnapshotSource;
  config: SimConfig;
}

const POD_HEIGHT = 0.12;
const POD_Y = POD_HEIGHT / 2;

const STORED_COLOR = new Color(FLOOR_PALETTE.podStored);
const RESERVED_COLOR = new Color(FLOOR_PALETTE.podReserved);

function sameBytes(previous: Uint8Array | null, next: Uint8Array): boolean {
  if (previous === null || previous.length !== next.length) return false;
  for (let index = 0; index < next.length; index++) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

/**
 * Pods are flat slabs on their fixed home slots. A slab is slate while
 * stored, safety yellow while reserved for a trip (so demand is visible
 * across the block), and removed while the pod is out at a station; the empty
 * slot shows the storage floor until the pod returns. Pods never change slot,
 * so instances are rewritten only when the state buffer changes.
 */
export function PodInstances({ source, config }: PodInstancesProps) {
  const meshRef = useRef<InstancedMesh>(null);
  const pod = useMemo(() => new Object3D(), []);
  const lastState = useRef<Uint8Array | null>(null);
  const worldPosition = useRef<WorldPosition>({ x: 0, z: 0 });

  const capacity = Math.max(1, config.pods.count);
  const grid = config.grid;

  useEffect(() => {
    if (meshRef.current) meshRef.current.count = 0;
    lastState.current = null;
  }, [config]);

  useFrame(() => {
    const mesh = meshRef.current;
    const snapshot = source.latest();
    if (!mesh || !snapshot) return;

    const { x, y, state } = snapshot.pods;
    const count = Math.min(state.length, mesh.instanceMatrix.count);
    mesh.count = count;
    if (sameBytes(lastState.current, state)) return;

    for (let index = 0; index < count; index++) {
      const code = state[index];
      const world = cellToWorldInto(x[index], y[index], grid, 1, worldPosition.current);
      pod.position.set(world.x, POD_Y, world.z);
      pod.scale.setScalar(code === POD_STATE_CODE.out ? 0 : 1);
      pod.updateMatrix();
      mesh.setMatrixAt(index, pod.matrix);
      mesh.setColorAt(index, code === POD_STATE_CODE.reserved ? RESERVED_COLOR : STORED_COLOR);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    lastState.current = state;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, capacity]}
      frustumCulled={false}
      raycast={() => null}
    >
      <boxGeometry args={[0.84, POD_HEIGHT, 0.84]} />
      <meshStandardMaterial roughness={0.85} metalness={0.05} />
    </instancedMesh>
  );
}
