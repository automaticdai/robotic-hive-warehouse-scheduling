'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { Hud } from '@/components/hud/Hud';
import { useSimConnection } from '@/components/hud/useSimConnection';
import { useHudStore, type HudClient, type HudScenario } from '@/lib/hudStore';
import { createSimWorker, SimClient } from '@/lib/simClient';
import { SnapshotSource } from '@/lib/snapshotSource';
import type { ConfigEntry, SimConfigResponse } from '@/server/discovery';
import type { SimConfig } from '@/sim/config';
import type { InitOptions } from '@/worker/protocol';

const HiveCanvas = dynamic(() => import('@/components/hive/HiveCanvas'), { ssr: false });

interface Boot {
  config: SimConfig;
  options: InitOptions;
}

export default function Page() {
  const [client, setClient] = useState<SimClient | null>(null);
  const [config, setConfig] = useState<SimConfig | null>(null);
  const [boot, setBoot] = useState<Boot | null>(null);
  const source = useMemo(() => new SnapshotSource(), []);

  // Subscribe before the init effect below posts its first worker message, so
  // no status/snapshot/inspection event is dropped.
  useSimConnection(client, source);

  useEffect(() => {
    let cancelled = false;
    let simClient: SimClient | null = null;

    async function start() {
      try {
        const [simResponse, configsResponse] = await Promise.all([
          fetch('/api/sim-config'),
          fetch('/api/configs'),
        ]);
        if (!simResponse.ok) {
          throw new Error(`Simulation config request failed (${simResponse.status})`);
        }
        if (!configsResponse.ok) {
          throw new Error(`Scenario request failed (${configsResponse.status})`);
        }
        const [data, entries] = await Promise.all([
          simResponse.json() as Promise<SimConfigResponse>,
          configsResponse.json() as Promise<ConfigEntry[]>,
        ]);

        // StrictMode unmounts between the fetch starting and resolving; do not
        // create a worker that cleanup can no longer reach.
        if (cancelled) return;

        simClient = new SimClient(createSimWorker());
        const scenarios: HudScenario[] = entries;
        useHudStore.setState({
          strategies: data.strategies,
          strategy: data.defaultConfig.allocation.strategy,
          scenarios,
          scenarioName: scenarios[0]?.name ?? 'default',
          pythonOnline: data.sidecar.online,
          error: null,
        });

        setConfig(data.defaultConfig);
        setBoot({
          config: data.defaultConfig,
          options: {
            strategy: data.defaultConfig.allocation.strategy,
            pythonUrl: data.sidecar.url,
            speed: 1,
          },
        });
        setClient(simClient);
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

  useEffect(() => {
    if (client === null || boot === null) return;
    const unsubscribeReady = client.onReady(() => useHudStore.setState({ error: null }));
    client.init(boot.config, boot.options);
    // Worker init starts paused; the ledger requires an explicit play.
    client.play();
    return unsubscribeReady;
  }, [client, boot]);

  // The HUD talks to this adapter rather than the raw client so scenario
  // restarts also drop the interpolated snapshots from the previous config.
  const hudClient = useMemo<HudClient>(
    () => ({
      play: () => client?.play(),
      pause: () => client?.pause(),
      step: () => client?.step(),
      setSpeed: (speed) => client?.setSpeed(speed),
      selectStrategy: (strategy) => client?.selectStrategy(strategy),
      inspect: (target) => client?.inspect(target),
      restart: (nextConfig) => {
        source.clear();
        client?.restart(nextConfig);
        setConfig(nextConfig);
      },
    }),
    [client, source],
  );

  return (
    <main>
      <h1 className="hud-page-title">Hive Warehouse Simulator</h1>
      {config !== null ? (
        <HiveCanvas
          source={source}
          config={config}
          onSelect={(target) => useHudStore.getState().setSelected(target)}
        />
      ) : null}
      <Hud client={hudClient} state={useHudStore} />
    </main>
  );
}
