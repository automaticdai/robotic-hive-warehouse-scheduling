'use client';

import { useMemo } from 'react';
import type { GridConfig } from '@/sim/config';

export interface GridFloorProps {
  grid: GridConfig;
}

const FLOOR_COLOR = '#0a0f0d';
const LINE_COLOR = '#3c5a50';
const LINE_OPACITY = 0.18;

/** Dark floor plane with cell-boundary lines scaled to the configured grid. */
export function GridFloor({ grid }: GridFloorProps) {
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

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[grid.width, grid.height]} />
        <meshStandardMaterial color={FLOOR_COLOR} roughness={1} metalness={0} />
      </mesh>
      <lineSegments position={[0, 0.01, 0]} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          color={LINE_COLOR}
          transparent
          opacity={LINE_OPACITY}
        />
      </lineSegments>
    </group>
  );
}
