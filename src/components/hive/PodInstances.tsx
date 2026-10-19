'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Object3D, type InstancedMesh } from 'three';
import type { SnapshotSource } from '@/lib/snapshotSource';
import type { SimConfig } from '@/sim/config';

export interface PodInstancesProps {
  source: SnapshotSource;
  config: SimConfig;
}

const POD_Y = 0.15;

function sameValues(previous: Float32Array | null, next: Float32Array): boolean {
  if (previous === null || previous.length !== next.length) return false;
  for (let index = 0; index < next.length; index++) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

function sameVisibility(previous: Uint8Array | null, next: Uint8Array): boolean {
  if (previous === null || previous.length !== next.length) return false;
  for (let index = 0; index < next.length; index++) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}

/**
 * Pods only move when a pod is reserved/replenished, so matrices are rewritten
 * only when the position or visibility buffers actually differ. Hidden pods
 * are collapsed to a zero scale instead of being removed from the mesh.
 */
export function PodInstances({ source, config }: PodInstancesProps) {
  const meshRef = useRef<InstancedMesh>(null);
  const pod = useMemo(() => new Object3D(), []);
  const lastX = useRef<Float32Array | null>(null);
  const lastY = useRef<Float32Array | null>(null);
  const lastVisible = useRef<Uint8Array | null>(null);

  const capacity = Math.max(1, config.pods.count);

  useEffect(() => {
    if (meshRef.current) meshRef.current.count = 0;
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    const snapshot = source.latest();
    if (!mesh || !snapshot) return;

    const { x, y, visible } = snapshot.pods;
    const count = Math.min(visible.length, mesh.instanceMatrix.count);
    mesh.count = count;

    if (
      sameValues(lastX.current, x) &&
      sameValues(lastY.current, y) &&
      sameVisibility(lastVisible.current, visible)
    ) {
      return;
    }

    for (let index = 0; index < count; index++) {
      pod.position.set(x[index], POD_Y, y[index]);
      pod.scale.setScalar(visible[index] ? 1 : 0);
      pod.updateMatrix();
      mesh.setMatrixAt(index, pod.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    lastX.current = x;
    lastY.current = y;
    lastVisible.current = visible;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, capacity]}
      frustumCulled={false}
    >
      <cylinderGeometry args={[0.3, 0.3, 0.3, 8]} />
      <meshStandardMaterial color="#8fb0a6" roughness={0.7} metalness={0.1} />
    </instancedMesh>
  );
}
