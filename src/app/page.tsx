'use client';

import { Hud } from '@/components/hud/Hud';
import { useHudStore, type HudClient } from '@/lib/hudStore';

const noop = () => undefined;

/**
 * Placeholder client until the worker-driven page lands in Task 12. Kept as a
 * module-scope typed no-op: it touches neither `window` nor a Worker.
 */
const noopClient: HudClient = {
  play: noop,
  pause: noop,
  step: noop,
  setSpeed: noop,
  selectStrategy: noop,
};

export default function Page() {
  return (
    <main>
      <h1 className="hud-page-title">Hive Warehouse Simulator</h1>
      <Hud client={noopClient} state={useHudStore} />
    </main>
  );
}
