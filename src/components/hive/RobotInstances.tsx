'use client';

import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, Object3D, type InstancedMesh } from 'three';
import type { SnapshotSource } from '@/lib/snapshotSource';
import type { SimConfig } from '@/sim/config';
import type { InspectionTarget } from '@/worker/protocol';
import { interpolate, ROBOT_STATUS_ORDER, stateColor } from './render';

export interface RobotInstancesProps {
  source: SnapshotSource;
  config: SimConfig;
  onSelect(target: InspectionTarget): void;
}

const ROBOT_Y = 0.4;
const CARRYING_Y = 0.55;
const POD_BLOCK_Y = 0.88;

/** Colours are parsed once; `stateColor` remains the single source of truth. */
const STATE_COLORS = ROBOT_STATUS_ORDER.map((status) => new Color(stateColor(status)));

/**
 * One instanced box per robot. Positions blend previous→current snapshot in
 * `useFrame`, so the field moves smoothly between worker messages. Carrying
 * robots ride slightly higher and get a small pod block above them.
 */
export function RobotInstances({ source, config, onSelect }: RobotInstancesProps) {
  const meshRef = useRef<InstancedMesh>(null);
  const carryRef = useRef<InstancedMesh>(null);
  const lastStates = useRef<Uint8Array | null>(null);
  const robot = useMemo(() => new Object3D(), []);
  const carriedPod = useMemo(() => new Object3D(), []);

  const capacity = Math.max(1, config.robots);

  useEffect(() => {
    // Snapshots arrive after mount; do not draw a full grid of robots at the
    // origin before the first one lands.
    if (meshRef.current) meshRef.current.count = 0;
    if (carryRef.current) carryRef.current.count = 0;
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    const carryMesh = carryRef.current;
    const sample = source.sample(performance.now());
    if (!mesh || !carryMesh || !sample) return;

    const { previous, current, alpha } = sample;
    const count = Math.min(current.robotIds.length, mesh.instanceMatrix.count);
    mesh.count = count;
    carryMesh.count = count;

    let colorsChanged = false;
    let states = lastStates.current;
    if (states === null || states.length !== count) {
      states = new Uint8Array(count).fill(255);
      lastStates.current = states;
      colorsChanged = true;
    }

    const previousX = previous?.robots.x;
    const previousY = previous?.robots.y;

    for (let index = 0; index < count; index++) {
      const currentX = current.robots.x[index] ?? 0;
      const currentZ = current.robots.y[index] ?? 0;
      const hasPrevious =
        previousX !== undefined &&
        previousY !== undefined &&
        index < previousX.length &&
        index < previousY.length;
      const x = hasPrevious ? interpolate(previousX[index], currentX, alpha) : currentX;
      const z = hasPrevious ? interpolate(previousY[index], currentZ, alpha) : currentZ;
      const carrying = current.robots.carrying[index] === 1;

      robot.position.set(x, carrying ? CARRYING_Y : ROBOT_Y, z);
      robot.updateMatrix();
      mesh.setMatrixAt(index, robot.matrix);

      carriedPod.position.set(x, POD_BLOCK_Y, z);
      carriedPod.scale.setScalar(carrying ? 1 : 0);
      carriedPod.updateMatrix();
      carryMesh.setMatrixAt(index, carriedPod.matrix);

      const state = current.robots.state[index] ?? 0;
      if (states[index] !== state) {
        states[index] = state;
        mesh.setColorAt(index, STATE_COLORS[state] ?? STATE_COLORS[0]);
        colorsChanged = true;
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    carryMesh.instanceMatrix.needsUpdate = true;
    if (colorsChanged && mesh.instanceColor !== null) {
      mesh.instanceColor.needsUpdate = true;
    }
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.instanceId === undefined) return;
    const id = source.latest()?.robotIds[event.instanceId];
    if (id !== undefined) onSelect({ type: 'robot', id });
  };

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
        onClick={handleClick}
      >
        <boxGeometry args={[0.7, 0.35, 0.7]} />
        <meshStandardMaterial roughness={0.55} metalness={0.15} />
      </instancedMesh>
      <instancedMesh
        ref={carryRef}
        args={[undefined, undefined, capacity]}
        frustumCulled={false}
        raycast={() => null}
      >
        <boxGeometry args={[0.4, 0.3, 0.4]} />
        <meshStandardMaterial color="#d8e8e2" roughness={0.6} metalness={0.1} />
      </instancedMesh>
    </group>
  );
}
