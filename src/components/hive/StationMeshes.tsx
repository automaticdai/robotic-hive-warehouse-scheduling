'use client';

import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
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
  source: SnapshotSource;
  onSelect(target: InspectionTarget): void;
}

function StationMesh({ station, position, source, onSelect }: StationMeshProps) {
  const materialRef = useRef<MeshStandardMaterial>(null);

  useFrame(() => {
    const live = source.latest()?.stations.find((entry) => entry.id === station.id);
    const next = live?.busy ? BUSY_COLOR : IDLE_COLOR;
    if (materialRef.current !== null && materialRef.current.color.getHex() !== next) {
      materialRef.current.color.setHex(next);
    }
  });

  return (
    <group position={[position.x, 0, position.z]}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onSelect({ type: 'station', id: station.id });
        }}
      >
        <boxGeometry args={[2.6, 1.2, 2.6]} />
        <meshStandardMaterial ref={materialRef} color={IDLE_COLOR} roughness={0.5} metalness={0.2} />
      </mesh>
      <Html position={[0, 1.7, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="station-label">{station.id}</div>
      </Html>
    </group>
  );
}

/** A clickable block and label for each configured station, outside the grid. */
export function StationMeshes({ source, config, onSelect }: StationMeshesProps) {
  const placements = useMemo(
    () =>
      config.stations.map((station) => ({
        station,
        position: stationWorldPosition(station, config.grid),
      })),
    [config],
  );

  return (
    <>
      {placements.map(({ station, position }) => (
        <StationMesh
          key={station.id}
          station={station}
          position={position}
          source={source}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
