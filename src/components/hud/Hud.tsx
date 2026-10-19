'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { HudClient, HudState } from '@/lib/hudStore';
import type { InspectionTarget } from '@/worker/protocol';
import { InspectorPanel } from './InspectorPanel';
import { MetricsPanel } from './MetricsPanel';
import { TopBar } from './TopBar';
import { TransportDock } from './TransportDock';

export type { HudClient } from '@/lib/hudStore';

export interface HudProps {
  client: HudClient;
  state: StoreApi<HudState>;
}

/**
 * `useLayoutEffect` warns during server rendering; fall back to `useEffect`
 * there. In the browser the layout effect lets callers mutate the store and
 * observe the resulting `inspect` command synchronously.
 */
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Layout-A floating HUD over the live hive view. */
export function Hud({ client, state }: HudProps) {
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
    <div className="hud-root">
      <TopBar state={state} />
      <MetricsPanel state={state} />
      <InspectorPanel state={state} />
      <TransportDock client={client} state={state} />
    </div>
  );
}
