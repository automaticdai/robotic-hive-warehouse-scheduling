'use client';

import { useEffect, useState } from 'react';
import type { SnapshotSource } from '@/lib/snapshotSource';
import type { Snapshot } from '@/sim/simulation';

/**
 * Polls the latest snapshot at a HUD-friendly rate. The scene reads every
 * frame; panels only need a few updates per second, and polling keeps React
 * renders off the 60 fps path.
 */
export function useLiveSnapshot(source: SnapshotSource | undefined, intervalMs = 400): Snapshot | null {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => source?.latest() ?? null);

  useEffect(() => {
    if (source === undefined) return;
    const timer = setInterval(() => setSnapshot(source.latest()), intervalMs);
    return () => clearInterval(timer);
  }, [source, intervalMs]);

  return snapshot;
}
