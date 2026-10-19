'use client';

import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { HudState } from '@/lib/hudStore';
import type { SnapshotSource } from '@/lib/snapshotSource';
import type { SimConfig } from '@/sim/config';
import type { InspectionTarget } from '@/worker/protocol';
import { CameraRig } from './CameraRig';
import { GridFloor } from './GridFloor';
import { PodInstances } from './PodInstances';
import { FLOOR_PALETTE } from './render';
import { RobotInstances } from './RobotInstances';
import { SelectionOverlay } from './SelectionOverlay';
import { StationMeshes } from './StationMeshes';

export interface HiveCanvasProps {
  source: SnapshotSource;
  config: SimConfig;
  state: StoreApi<HudState>;
  onSelect(target: InspectionTarget): void;
}

/** Live 3D hive view; mounted client-side only by the page. */
export default function HiveCanvas({ source, config, state, onSelect }: HiveCanvasProps) {
  const view = useStore(state, (s) => s.view);

  return (
    <div className="hive-canvas">
      <Canvas
        camera={{ position: [0, 110, 6], fov: 40, near: 0.5, far: 1000 }}
        frameloop="always"
        gl={{ antialias: true }}
      >
        <color attach="background" args={[FLOOR_PALETTE.background]} />
        <hemisphereLight args={['#ffffff', '#b9bdb6', 1.6]} />
        <directionalLight position={[-40, 120, 60]} intensity={1.5} />
        <Suspense fallback={null}>
          <GridFloor config={config} />
          <PodInstances source={source} config={config} />
          <StationMeshes source={source} config={config} onSelect={onSelect} />
          <RobotInstances source={source} config={config} onSelect={onSelect} />
          <SelectionOverlay source={source} config={config} state={state} />
        </Suspense>
        <OrbitControls makeDefault enableDamping maxPolarAngle={Math.PI / 2.2} />
        <CameraRig view={view} grid={config.grid} />
      </Canvas>
    </div>
  );
}
