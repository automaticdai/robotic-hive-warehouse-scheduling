'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { Hud } from '@/components/hud/Hud';
import { useHudStore, type HudClient } from '@/lib/hudStore';
import { createSimWorker, SimClient } from '@/lib/simClient';
import { SnapshotSource } from '@/lib/snapshotSource';
import type { SimConfigResponse } from '@/server/discovery';
import type { SimConfig } from '@/sim/config';
import type { InspectionTarget } from '@/worker/protocol';

const HiveCanvas = dynamic(() => import('@/components/hive/HiveCanvas'), { ssr: false });

const noop = () => undefined;

/** Typed no-op client so the HUD stays usable while the worker spins up. */
const noopClient: HudClient = {
  play: noop,
  pause: noop,
  step: noop,
  setSpeed: noop,
  selectStrategy: noop,
};

export default function Page() {
  const [client, setClient] = useState<SimClient | null>(null);
  const [config, setConfig] = useState<SimConfig | null>(null);
  const source = useMemo(() => new SnapshotSource(), []);

  useEffect(() => {
    let cancelled = false;
    let simClient: SimClient | null = null;

    async function start() {
      try {
        const response = await fetch('/api/sim-config');
        if (!response.ok) {
          throw new Error(`Simulation config request failed (${response.status})`);
        }
        const data = (await response.json()) as SimConfigResponse;

        // StrictMode unmounts between the fetch starting and resolving; do not
        // create a worker that cleanup can no longer reach.
        if (cancelled) return;

        simClient = new SimClient(createSimWorker());
        simClient.onSnapshot((snapshot) => source.push(snapshot, performance.now()));
        simClient.onStatus((status) => useHudStore.getState().applyStatus(status));
        simClient.onReady(() => useHudStore.setState({ error: null }));

        simClient.init(data.defaultConfig, {
          strategy: data.defaultConfig.allocation.strategy,
          pythonUrl: data.sidecar.url,
          speed: 1,
        });
        useHudStore.setState({
          strategies: data.strategies,
          strategy: data.defaultConfig.allocation.strategy,
          scenarioName: 'default',
          pythonOnline: data.sidecar.online,
          error: null,
        });

        setConfig(data.defaultConfig);
        setClient(simClient);
        // Worker init starts paused; the ledger requires an explicit play.
        simClient.play();
      } catch (error) {
        if (cancelled) return;
        useHudStore.setState({
          error: error instanceof Error ? error.message : 'Failed to start the simulation',
        });
      }
    }

    void start();

    return () => {
      cancelled = true;
      simClient?.dispose();
    };
  }, [source]);

  const handleSelect = (target: InspectionTarget) => {
    useHudStore.getState().setSelected(target);
  };

  return (
    <main>
      <h1 className="hud-page-title">Hive Warehouse Simulator</h1>
      {config !== null ? (
        <HiveCanvas source={source} config={config} onSelect={handleSelect} />
      ) : null}
      <Hud client={client ?? noopClient} state={useHudStore} />
    </main>
  );
}
