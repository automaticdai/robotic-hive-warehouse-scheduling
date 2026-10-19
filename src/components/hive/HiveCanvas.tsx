'use client';

import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import type { SnapshotSource } from '@/lib/snapshotSource';
import type { SimConfig } from '@/sim/config';
import type { InspectionTarget } from '@/worker/protocol';
import { GridFloor } from './GridFloor';
import { PodInstances } from './PodInstances';
import { RobotInstances } from './RobotInstances';
import { StationMeshes } from './StationMeshes';

export interface HiveCanvasProps {
  source: SnapshotSource;
  config: SimConfig;
  onSelect(target: InspectionTarget): void;
}

/** Live 3D hive view; mounted client-side only by the page. */
export default function HiveCanvas({ source, config, onSelect }: HiveCanvasProps) {
  return (
    <div className="hive-canvas">
      <Canvas
        camera={{ position: [0, 90, 90], fov: 45 }}
        frameloop="always"
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#070b0a']} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[60, 120, 40]} intensity={1.4} />
        <Suspense fallback={null}>
          <GridFloor grid={config.grid} />
          <PodInstances source={source} config={config} />
          <StationMeshes source={source} config={config} onSelect={onSelect} />
          <RobotInstances source={source} config={config} onSelect={onSelect} />
        </Suspense>
        <OrbitControls makeDefault enableDamping />
      </Canvas>
    </div>
  );
}
