'use client';

import { useMemo } from 'react';
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { boundingRect, podSlots } from '@/sim/layout';
import type { SimConfig } from '@/sim/config';
import { cellToWorld, FLOOR_PALETTE, portZoneRect, rectToWorld } from './render';

export interface GridFloorProps {
  config: SimConfig;
}

/** Extra concrete around the grid so edge stations sit on the floor. */
const APRON_CELLS = 8;
const LINE_OPACITY = 0.14;

/** Diagonal safety-yellow and ink hatching, the floor marking for port zones. */
function createHatchTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (context === null) return null;

  context.fillStyle = FLOOR_PALETTE.safety;
  context.fillRect(0, 0, size, size);
  context.strokeStyle = FLOOR_PALETTE.ink;
  context.lineWidth = size / 6;
  for (let offset = -size; offset <= size * 2; offset += size / 2) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset - size, size);
    context.stroke();
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Painted floor plan: concrete apron, the pod storage block, hatched port
 * zones in front of every station and dark dock cells where pods are handed
 * over. Faint cell lines cover the whole hive.
 */
export function GridFloor({ config }: GridFloorProps) {
  const { grid } = config;

  const linePositions = useMemo(() => {
    const positions: number[] = [];
    const halfWidth = grid.width / 2;
    const halfHeight = grid.height / 2;
    for (let column = 0; column <= grid.width; column++) {
      const x = -halfWidth + column;
      positions.push(x, 0, -halfHeight, x, 0, halfHeight);
    }
    for (let row = 0; row <= grid.height; row++) {
      const z = -halfHeight + row;
      positions.push(-halfWidth, 0, z, halfWidth, 0, z);
    }
    return new Float32Array(positions);
  }, [grid.width, grid.height]);

  // The slab marks the pod block itself, so the aisles around it read as
  // open floor where robots park and travel.
  const storage = useMemo(() => {
    const block = boundingRect(podSlots(config, config.pods.count));
    return block === null ? null : rectToWorld(block, grid);
  }, [config, grid]);

  const zones = useMemo(
    () =>
      config.stations.map((station) => {
        const rect = rectToWorld(portZoneRect(station, grid, config.layout.portClearance), grid);
        const texture = createHatchTexture();
        texture?.repeat.set(rect.width / 2, rect.depth / 2);
        return { id: station.id, rect, texture };
      }),
    [config, grid],
  );

  const docks = useMemo(
    () =>
      config.stations.flatMap((station) =>
        station.docks.map((dock) => ({
          key: `${dock.x},${dock.y}`,
          position: cellToWorld(dock, grid),
        })),
      ),
    [config, grid],
  );

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[grid.width + APRON_CELLS * 2, grid.height + APRON_CELLS * 2]} />
        <meshStandardMaterial color={FLOOR_PALETTE.floor} roughness={1} metalness={0} />
      </mesh>
      {storage ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[storage.x, 0, storage.z]}>
          <planeGeometry args={[storage.width, storage.depth]} />
          <meshStandardMaterial color={FLOOR_PALETTE.storage} roughness={1} metalness={0} />
        </mesh>
      ) : null}
      {zones.map(({ id, rect, texture }) => (
        <mesh key={id} rotation={[-Math.PI / 2, 0, 0]} position={[rect.x, 0.004, rect.z]}>
          <planeGeometry args={[rect.width, rect.depth]} />
          <meshStandardMaterial
            map={texture}
            color={texture === null ? FLOOR_PALETTE.safety : '#ffffff'}
            roughness={1}
            metalness={0}
            transparent
            opacity={0.55}
          />
        </mesh>
      ))}
      {docks.map(({ key, position }) => (
        <mesh key={key} rotation={[-Math.PI / 2, 0, 0]} position={[position.x, 0.008, position.z]}>
          <planeGeometry args={[0.92, 0.92]} />
          <meshStandardMaterial color={FLOOR_PALETTE.dock} roughness={0.8} metalness={0} />
        </mesh>
      ))}
      <lineSegments position={[0, 0.012, 0]} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={FLOOR_PALETTE.gridLine} transparent opacity={LINE_OPACITY} />
      </lineSegments>
    </group>
  );
}
