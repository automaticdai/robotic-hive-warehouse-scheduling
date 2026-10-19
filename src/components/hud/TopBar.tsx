'use client';

import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { HudClient, HudState } from '@/lib/hudStore';
import { formatSimClock } from './format';

export { formatSimClock } from './format';

export interface TopBarProps {
  state: StoreApi<HudState>;
  client?: HudClient;
}

/** Run identity: what is loaded, which allocator drives it, and sim time. */
export function TopBar({ state, client }: TopBarProps) {
  const simTimeMs = useStore(state, (s) => s.simTimeMs);
  const pythonOnline = useStore(state, (s) => s.pythonOnline);
  const error = useStore(state, (s) => s.error);
  const strategies = useStore(state, (s) => s.strategies);
  const strategy = useStore(state, (s) => s.strategy);
  const scenarios = useStore(state, (s) => s.scenarios);
  const scenarioName = useStore(state, (s) => s.scenarioName);
  // The initial name may not correspond to a loaded scenario (for example
  // 'default'); keep a matching option so the select never has a bare value.
  const hasScenarioOption = scenarios.some((scenario) => scenario.name === scenarioName);

  return (
    <header className="topbar">
      <h1 className="brand">
        <span className="brand-mark" aria-hidden="true" />
        Hive warehouse simulator
      </h1>
      <label className="field">
        <span>Scenario</span>
        <select
          aria-label="Scenario"
          value={scenarioName}
          disabled={scenarios.length === 0 || client === undefined}
          onChange={(event) => {
            const next = event.target.value;
            const scenario = state.getState().scenarios.find((entry) => entry.name === next);
            if (scenario === undefined) return;
            client?.restart?.(scenario.config);
            state.getState().setScenario(next);
          }}
        >
          {hasScenarioOption ? null : (
            <option value={scenarioName}>{scenarioName || 'default'}</option>
          )}
          {scenarios.map((scenario) => (
            <option key={scenario.name} value={scenario.name}>
              {scenario.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Algorithm</span>
        <select
          aria-label="Algorithm"
          value={strategy}
          disabled={client === undefined}
          onChange={(event) => client?.selectStrategy(event.target.value)}
        >
          {strategies.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <span className={`python-status ${pythonOnline ? 'is-online' : 'is-offline'}`}>
        {pythonOnline ? 'Python online' : 'Python offline — FCFS only'}
      </span>
      {error !== null ? (
        <span className="topbar-error" role="alert" title={error}>
          {error}
        </span>
      ) : null}
      <span className="sim-clock" aria-label="Simulation time">
        <span className="sim-clock-label">Sim time</span>
        {formatSimClock(simTimeMs)}
      </span>
    </header>
  );
}
