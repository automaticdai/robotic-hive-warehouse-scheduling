'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useMemo, useRef } from 'react';
import { Vector3, type MeshStandardMaterial } from 'three';
import type { SnapshotSource } from '@/lib/snapshotSource';
import type { SimConfig, StationConfig } from '@/sim/config';
import type { InspectionTarget } from '@/worker/protocol';
import { FLOOR_PALETTE, stationOutward, stationWorldPosition } from './render';

export interface StationMeshesProps {
  source: SnapshotSource;
  config: SimConfig;
  onSelect(target: InspectionTarget): void;
}

const IDLE_CAP = 0x9aa3a6;
const BUSY_CAP = 0xf2c230;

/** Height above the floor that a station's DOM label is pinned to. */
const LABEL_Y = 1.7;

interface StationMeshProps {
  station: StationConfig;
  position: { x: number; z: number };
  span: { width: number; depth: number };
  registerCap(id: string, material: MeshStandardMaterial | null): void;
  onSelect(target: InspectionTarget): void;
}

function StationMesh({ station, position, span, registerCap, onSelect }: StationMeshProps) {
  return (
    <group position={[position.x, 0, position.z]}>
      <mesh
        position={[0, 0.7, 0]}
        onClick={(event) => {
          event.stopPropagation();
          onSelect({ type: 'station', id: station.id });
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <boxGeometry args={[span.width, 1.4, span.depth]} />
        <meshStandardMaterial color={FLOOR_PALETTE.ink} roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[0, 1.45, 0]} raycast={() => null}>
        <boxGeometry args={[span.width, 0.1, span.depth]} />
        <meshStandardMaterial
          ref={(material) => registerCap(station.id, material)}
          color={IDLE_CAP}
          roughness={0.5}
        />
      </mesh>
    </group>
  );
}

/**
 * A port block outside the grid wall for each station. Its cap lights up in
 * safety yellow while a pod is being picked. Labels are ordinary DOM elements
 * in the stage (see `StationLabels`); this component pins them to the blocks
 * by projecting each block into screen space every frame.
 */
export function StationMeshes({ source, config, onSelect }: StationMeshesProps) {
  const camera = useThree((state) => state.camera);
  const canvas = useThree((state) => state.gl.domElement);
  const size = useThree((state) => state.size);

  const placements = useMemo(
    () =>
      config.stations.map((station) => {
        const outward = stationOutward(station, config.grid);
        const along = station.docks.map((dock) => (outward.x !== 0 ? dock.y : dock.x));
        const length = Math.max(...along) - Math.min(...along) + 3;
        return {
          station,
          position: stationWorldPosition(station, config.grid, 1, 2),
          span: outward.x !== 0 ? { width: 2.2, depth: length } : { width: length, depth: 2.2 },
        };
      }),
    [config],
  );

  const caps = useRef(new Map<string, MeshStandardMaterial>());
  const labels = useRef(new Map<string, HTMLElement>());
  const projected = useMemo(() => new Vector3(), []);
  const registerCap = useCallback((id: string, material: MeshStandardMaterial | null) => {
    if (material === null) caps.current.delete(id);
    else caps.current.set(id, material);
  }, []);

  useFrame(() => {
    const liveStations = source.latest()?.stations;
    if (liveStations) {
      for (const live of liveStations) {
        const material = caps.current.get(live.id);
        const next = live.busy ? BUSY_CAP : IDLE_CAP;
        if (material && material.color.getHex() !== next) material.color.setHex(next);
      }
    }

    const stage = canvas.closest('.stage');
    if (stage === null) return;
    for (const { station, position } of placements) {
      let label = labels.current.get(station.id);
      if (label === undefined || !label.isConnected) {
        label = stage.querySelector<HTMLElement>(`[data-station-label="${station.id}"]`) ?? undefined;
        if (label === undefined) continue;
        labels.current.set(station.id, label);
      }
      projected.set(position.x, LABEL_Y, position.z).project(camera);
      const x = ((projected.x + 1) / 2) * size.width;
      const y = ((1 - projected.y) / 2) * size.height;
      label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      label.style.visibility = projected.z < 1 ? 'visible' : 'hidden';
    }
  });

  return (
    <>
      {placements.map(({ station, position, span }) => (
        <StationMesh
          key={station.id}
          station={station}
          position={position}
          span={span}
          registerCap={registerCap}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
