'use client';

import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { HudState } from '@/lib/hudStore';
import type { SnapshotSource } from '@/lib/snapshotSource';
import type { SimConfig } from '@/sim/config';
import {
  cellToWorld,
  FLOOR_PALETTE,
  interpolatedWorldPosition,
  portZoneRect,
  rectToWorld,
  type WorldPosition,
} from './render';

export interface SelectionOverlayProps {
  source: SnapshotSource;
  config: SimConfig;
  state: StoreApi<HudState>;
}

const ROUTE_Y = 0.62;

/**
 * Draws what the selected robot is doing: a ring that follows it, its
 * remaining route, and the home slot of the pod it is fetching. A selected
 * station gets an outline around its port zone.
 */
export function SelectionOverlay({ source, config, state }: SelectionOverlayProps) {
  const selected = useStore(state, (s) => s.selected);
  const inspection = useStore(state, (s) => s.inspection);
  const ringRef = useRef<Group>(null);
  const indexRef = useRef<{ id: string; index: number } | null>(null);
  const position = useRef<WorldPosition>({ x: 0, z: 0 });
  const grid = config.grid;

  useFrame(() => {
    const ring = ringRef.current;
    if (!ring) return;
    if (selected?.type !== 'robot') {
      ring.visible = false;
      return;
    }
    const sample = source.sample(performance.now() - source.intervalMs());
    if (!sample) return;
    if (indexRef.current?.id !== selected.id) {
      indexRef.current = { id: selected.id, index: sample.current.robotIds.indexOf(selected.id) };
    }
    const index = indexRef.current.index;
    if (index < 0) {
      ring.visible = false;
      return;
    }
    const world = interpolatedWorldPosition(
      sample.previous,
      sample.current,
      sample.alpha,
      index,
      grid,
      position.current,
    );
    ring.visible = true;
    ring.position.set(world.x, 0.05, world.z);
  });

  const route = useMemo(() => {
    if (inspection?.type !== 'robot' || !inspection.cell || !inspection.path?.length) return null;
    return [inspection.cell, ...inspection.path].map((cell) => {
      const world = cellToWorld(cell, grid);
      return [world.x, ROUTE_Y, world.z] as [number, number, number];
    });
  }, [inspection, grid]);

  const pickup =
    inspection?.type === 'robot' && inspection.pickup && !inspection.tripProgress.carrying
      ? cellToWorld(inspection.pickup, grid)
      : null;

  const stationZone = useMemo(() => {
    if (selected?.type !== 'station') return null;
    const station = config.stations.find((entry) => entry.id === selected.id);
    if (!station) return null;
    const rect = rectToWorld(portZoneRect(station, grid, config.layout.portClearance), grid);
    const halfW = rect.width / 2 + 0.3;
    const halfD = rect.depth / 2 + 0.3;
    return [
      [rect.x - halfW, 0.05, rect.z - halfD],
      [rect.x + halfW, 0.05, rect.z - halfD],
      [rect.x + halfW, 0.05, rect.z + halfD],
      [rect.x - halfW, 0.05, rect.z + halfD],
      [rect.x - halfW, 0.05, rect.z - halfD],
    ] as [number, number, number][];
  }, [selected, config, grid]);

  return (
    <group>
      <group ref={ringRef} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[0.75, 1.05, 32]} />
          <meshBasicMaterial color={FLOOR_PALETTE.ink} />
        </mesh>
      </group>
      {route ? (
        <Line points={route} color={FLOOR_PALETTE.ink} lineWidth={2.5} dashed dashSize={0.6} gapSize={0.35} />
      ) : null}
      {pickup ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[pickup.x, 0.2, pickup.z]} raycast={() => null}>
          <ringGeometry args={[0.55, 0.85, 4, 1, Math.PI / 4]} />
          <meshBasicMaterial color={FLOOR_PALETTE.ink} />
        </mesh>
      ) : null}
      {stationZone ? <Line points={stationZone} color={FLOOR_PALETTE.ink} lineWidth={3} /> : null}
    </group>
  );
}
