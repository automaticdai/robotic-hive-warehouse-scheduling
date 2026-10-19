'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type { PerspectiveCamera } from 'three';
import type { HudView } from '@/lib/hudStore';
import type { GridConfig } from '@/sim/config';

export interface CameraRigProps {
  view: HudView;
  grid: GridConfig;
}

interface OrbitLike {
  target: { set(x: number, y: number, z: number): void };
  update(): void;
}

/**
 * Moves the camera to a preset whenever the view changes. Plan looks almost
 * straight down so the floor reads like a drawing; angled shows robot and pod
 * heights. Orbit controls stay free between preset changes.
 */
/** Cells of floor kept in view around the grid, for the edge stations. */
const FRAME_MARGIN = 8;

export function CameraRig({ view, grid }: CameraRigProps) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const controls = useThree((state) => state.controls) as unknown as OrbitLike | null;
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height));

  useEffect(() => {
    // Distance at which the framed floor fits both the vertical field of view
    // and, through the aspect ratio, the horizontal one.
    const halfFov = ((camera.fov ?? 40) * Math.PI) / 360;
    const framedW = grid.width + FRAME_MARGIN * 2;
    const framedH = grid.height + FRAME_MARGIN * 2;
    const fit = Math.max(framedH, framedW / aspect) / 2 / Math.tan(halfFov);

    if (view === 'plan') camera.position.set(0, fit, fit * 0.04);
    else camera.position.set(-fit * 0.3, fit * 0.62, fit * 0.72);
    camera.lookAt(0, 0, 0);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [view, grid.width, grid.height, aspect, camera, controls]);

  return null;
}
