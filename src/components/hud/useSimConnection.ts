'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useHudStore } from '@/lib/hudStore';
import type { SimClient } from '@/lib/simClient';
import type { SnapshotSource } from '@/lib/snapshotSource';

/**
 * Bridges a `SimClient` to the render-side snapshot buffer and the app store.
 * Snapshots feed `SnapshotSource`, while status and inspection events update
 * the HUD store. Metrics arrive inside `StatusEvent`, so they are not
 * subscribed separately (that would double-append throughput history).
 *
 * Returns a stable cleanup that detaches every subscription; React also runs
 * it automatically when the client or source changes and on unmount.
 */
export function useSimConnection(
  client: SimClient | null,
  source: SnapshotSource,
): () => void {
  const cleanupRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (client === null) {
      cleanupRef.current = () => undefined;
      return;
    }

    const unsubscribers = [
      client.onSnapshot((snapshot) => source.push(snapshot, performance.now())),
      client.onStatus((status) => useHudStore.getState().applyStatus(status)),
      client.onInspection((_target, detail) =>
        useHudStore.getState().applyInspection(detail),
      ),
    ];

    const unsubscribeAll = () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
    cleanupRef.current = unsubscribeAll;
    return unsubscribeAll;
  }, [client, source]);

  return useCallback(() => cleanupRef.current(), []);
}
