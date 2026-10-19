'use client';

import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { HudClient, HudState } from '@/lib/hudStore';

export interface TransportDockProps {
  client: HudClient;
  state: StoreApi<HudState>;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];

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
  const strategies = useStore(state, (s) => s.strategies);
  const strategy = useStore(state, (s) => s.strategy);

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
      <label className="hud-control">
        <span>Algorithm</span>
        <select
          aria-label="Algorithm"
          value={strategy}
          onChange={(event) => {
            const next = event.target.value;
            client.selectStrategy(next);
            state.getState().setStrategy(next);
          }}
        >
          {strategies.map((option) => (
            <option key={option} value={option}>
              {option}
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
