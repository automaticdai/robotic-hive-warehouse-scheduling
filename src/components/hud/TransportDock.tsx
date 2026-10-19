'use client';

import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { HudClient, HudState } from '@/lib/hudStore';

export interface TransportDockProps {
  client: HudClient;
  state: StoreApi<HudState>;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];

/** Achieved speed is considered lagging below this fraction of the target. */
const LAG_WARNING_RATIO = 0.75;

function formatMultiplier(value: number): string {
  return `${Math.round(value * 100) / 100}×`;
}

const LEGEND = [
  { label: 'idle', color: '#5f7d8c' },
  { label: 'moving empty', color: '#e8a33d' },
  { label: 'moving loaded', color: '#d8e8e2' },
  { label: 'waiting', color: '#c0442f' },
  { label: 'at station', color: '#9b6bd6' },
];

export function TransportDock({ client, state }: TransportDockProps) {
  const running = useStore(state, (s) => s.running);
  const speed = useStore(state, (s) => s.speed);
  const achievedSpeed = useStore(state, (s) => s.achievedSpeed);
  const lagging =
    running && achievedSpeed !== null && achievedSpeed < speed * LAG_WARNING_RATIO;
  const strategies = useStore(state, (s) => s.strategies);
  const strategy = useStore(state, (s) => s.strategy);
  const scenarios = useStore(state, (s) => s.scenarios);
  const scenarioName = useStore(state, (s) => s.scenarioName);
  // The initial name may not correspond to a loaded scenario (for example
  // 'default'); keep a matching option so the select never has a bare value.
  const hasScenarioOption = scenarios.some((scenario) => scenario.name === scenarioName);

  return (
    <div className="hud-panel hud-dock">
      <button
        type="button"
        className="hud-button hud-button-primary"
        onClick={() => (running ? client.pause() : client.play())}
      >
        {running ? 'Pause' : 'Play'}
      </button>
      <button type="button" className="hud-button" onClick={() => client.step()}>
        Step
      </button>
      <button
        type="button"
        className="hud-button"
        onClick={() => client.restartCurrent?.()}
        disabled={client.restartCurrent === undefined}
      >
        Restart
      </button>
      <label className="hud-control">
        <span>Speed</span>
        <select
          aria-label="Speed"
          value={String(speed)}
          onChange={(event) => client.setSpeed(Number(event.target.value))}
        >
          {SPEEDS.map((option) => (
            <option key={option} value={String(option)}>
              {option}×
            </option>
          ))}
        </select>
      </label>
      <span
        className={`hud-achieved ${lagging ? 'hud-achieved-lagging' : ''}`}
        aria-label="Achieved speed"
      >
        {running
          ? achievedSpeed === null
            ? 'achieved —'
            : `achieved ${formatMultiplier(achievedSpeed)}`
          : 'achieved —'}
      </span>
      <label className="hud-control">
        <span>Algorithm</span>
        <select
          aria-label="Algorithm"
          value={strategy}
          onChange={(event) => client.selectStrategy(event.target.value)}
        >
          {strategies.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="hud-control">
        <span>Scenario</span>
        <select
          aria-label="Scenario"
          value={scenarioName}
          disabled={scenarios.length === 0}
          onChange={(event) => {
            const next = event.target.value;
            const scenario = state.getState().scenarios.find((entry) => entry.name === next);
            if (scenario === undefined) return;
            client.restart?.(scenario.config);
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
      <ul className="hud-legend" aria-label="Robot state legend">
        {LEGEND.map((entry) => (
          <li key={entry.label} className="hud-legend-item">
            <span
              className="hud-swatch"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />
            {entry.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
