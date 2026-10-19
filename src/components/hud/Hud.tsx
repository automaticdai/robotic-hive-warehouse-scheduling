'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { HudClient, HudState } from '@/lib/hudStore';
import type { SnapshotSource } from '@/lib/snapshotSource';
import type { InspectionTarget } from '@/worker/protocol';
import { FleetPanel } from './FleetPanel';
import { FloorKey } from './FloorKey';
import { InspectorPanel } from './InspectorPanel';
import { MetricsPanel } from './MetricsPanel';
import { StationLabels } from './StationLabels';
import { StationsPanel } from './StationsPanel';
import { TopBar } from './TopBar';
import { TransportDock } from './TransportDock';
import { useLiveSnapshot } from './useLiveSnapshot';

export type { HudClient } from '@/lib/hudStore';

export interface HudProps {
  client: HudClient;
  state: StoreApi<HudState>;
  /** Live snapshots for the fleet and station panels. */
  source?: SnapshotSource;
  /** The hive view, placed in the centre of the shell. */
  stage?: ReactNode;
}

/**
 * `useLayoutEffect` warns during server rendering; fall back to `useEffect`
 * there. In the browser the layout effect lets callers mutate the store and
 * observe the resulting `inspect` command synchronously.
 */
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Application shell: run identity across the top, order flow and fleet on
 * the left, the hive floor in the centre, stations and the inspector on the
 * right, and run controls along the bottom.
 */
export function Hud({ client, state, source, stage }: HudProps) {
  const snapshot = useLiveSnapshot(source);
  const selected = useStore(state, (s) => s.selected);
  // `undefined` distinguishes "not yet inspected" from "inspected nothing".
  const lastInspected = useRef<InspectionTarget | null | undefined>(undefined);

  const sendInspection = useCallback(
    (target: InspectionTarget | null) => {
      if (lastInspected.current === target) return;
      const isInitialNull = lastInspected.current === undefined && target === null;
      lastInspected.current = target;
      // The initial null selection is not an inspection change.
      if (isInitialNull) return;
      client.inspect?.(target);
    },
    [client],
  );

  // A direct store subscription keeps `inspect` synchronous with
  // `setSelected`, even when the store is updated outside React.
  useIsomorphicLayoutEffect(() => {
    const current = state.getState().selected;
    if (current !== null) sendInspection(current);
    return state.subscribe((next, previous) => {
      if (next.selected !== previous.selected) sendInspection(next.selected);
    });
  }, [sendInspection, state]);

  // The `useStore` subscription above drives this path; it is deduplicated so
  // an update that already dispatched through `state.subscribe` does not
  // repeat the command.
  useIsomorphicLayoutEffect(() => {
    sendInspection(selected);
  }, [selected, sendInspection]);

  return (
    <div className="app-shell">
      <TopBar state={state} client={client} />
      <aside className="rail rail-left" aria-label="Orders and fleet">
        <MetricsPanel state={state} />
        <FleetPanel state={state} snapshot={snapshot} />
      </aside>
      <section className="stage" aria-label="Hive floor">
        {stage}
        <StationLabels snapshot={snapshot} />
        <FloorKey />
      </section>
      <aside className="rail rail-right" aria-label="Stations and inspector">
        <StationsPanel state={state} snapshot={snapshot} />
        <InspectorPanel state={state} />
      </aside>
      <TransportDock client={client} state={state} />
    </div>
  );
}
