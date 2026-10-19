'use client';

import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useCallback, useMemo, useRef } from 'react';
import type { MeshStandardMaterial } from 'three';
import type { SnapshotSource } from '@/lib/snapshotSource';
import type { SimConfig, StationConfig } from '@/sim/config';
import type { InspectionTarget } from '@/worker/protocol';
import { stationWorldPosition } from './render';

export interface StationMeshesProps {
  source: SnapshotSource;
  config: SimConfig;
  onSelect(target: InspectionTarget): void;
}

const IDLE_COLOR = 0x2f6f5e;
const BUSY_COLOR = 0xe8a33d;

interface StationMeshProps {
  station: StationConfig;
  position: { x: number; z: number };
  registerMaterial(id: string, material: MeshStandardMaterial | null): void;
  onSelect(target: InspectionTarget): void;
}

function StationMesh({ station, position, registerMaterial, onSelect }: StationMeshProps) {
  return (
    <group position={[position.x, 0, position.z]}>
      <mesh
        position={[0, 0.6, 0]}
        onClick={(event) => {
          event.stopPropagation();
          onSelect({ type: 'station', id: station.id });
        }}
      >
        <boxGeometry args={[2, 1.2, 2]} />
        <meshStandardMaterial
          ref={(material) => registerMaterial(station.id, material)}
          color={IDLE_COLOR}
          roughness={0.5}
          metalness={0.2}
        />
      </mesh>
      <Html position={[0, 1.7, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="station-label">{station.id}</div>
      </Html>
    </group>
  );
}

/** A clickable block and label for each configured station, outside the grid. */
export function StationMeshes({ source, config, onSelect }: StationMeshesProps) {
  // Config stations keyed by id, so neither placement nor the frame loop needs
  // to scan the config array.
  const stationById = useMemo(
    () => new Map(config.stations.map((station) => [station.id, station])),
    [config],
  );
  const placements = useMemo(
    () =>
      [...stationById.values()].map((station) => ({
        station,
        position: stationWorldPosition(station, config.grid),
      })),
    [stationById, config.grid],
  );

  const materialById = useRef(new Map<string, MeshStandardMaterial>());
  const registerMaterial = useCallback(
    (id: string, material: MeshStandardMaterial | null) => {
      if (material === null) materialById.current.delete(id);
      else materialById.current.set(id, material);
    },
    [],
  );

  // One pass over the snapshot stations with O(1) material lookups instead of
  // a `.find` per station per frame.
  useFrame(() => {
    const liveStations = source.latest()?.stations;
    if (!liveStations) return;
    for (const live of liveStations) {
      const material = materialById.current.get(live.id);
      if (!material) continue;
      const next = live.busy ? BUSY_COLOR : IDLE_COLOR;
      if (material.color.getHex() !== next) material.color.setHex(next);
    }
  });

  return (
    <>
      {placements.map(({ station, position }) => (
        <StationMesh
          key={station.id}
          station={station}
          position={position}
          registerMaterial={registerMaterial}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
