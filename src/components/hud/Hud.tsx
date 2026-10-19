'use client';

import type { StoreApi } from 'zustand/vanilla';
import type { HudClient, HudState } from '@/lib/hudStore';
import { InspectorPanel } from './InspectorPanel';
import { MetricsPanel } from './MetricsPanel';
import { TopBar } from './TopBar';
import { TransportDock } from './TransportDock';

export type { HudClient } from '@/lib/hudStore';

export interface HudProps {
  client: HudClient;
  state: StoreApi<HudState>;
}

/** Layout-A floating HUD over the live hive view. */
export function Hud({ client, state }: HudProps) {
  return (
    <div className="hud-root">
      <TopBar state={state} />
      <MetricsPanel state={state} />
      <InspectorPanel state={state} />
      <TransportDock client={client} state={state} />
    </div>
  );
}
