'use client';

import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { HudClient, HudState, HudView } from '@/lib/hudStore';

export interface TransportDockProps {
  client: HudClient;
  state: StoreApi<HudState>;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];

const VIEWS: { value: HudView; label: string }[] = [
  { value: 'plan', label: 'Plan' },
  { value: 'angled', label: 'Angled' },
];

/** Achieved speed is considered lagging below this fraction of the target. */
const LAG_WARNING_RATIO = 0.75;

function formatMultiplier(value: number): string {
  return `${Math.round(value * 100) / 100}×`;
}

export function TransportDock({ client, state }: TransportDockProps) {
  const running = useStore(state, (s) => s.running);
  const speed = useStore(state, (s) => s.speed);
  const achievedSpeed = useStore(state, (s) => s.achievedSpeed);
  const view = useStore(state, (s) => s.view);
  const lagging =
    running && achievedSpeed !== null && achievedSpeed < speed * LAG_WARNING_RATIO;

  return (
    <footer className="dock">
      <div className="dock-group">
        <button
          type="button"
          className="button button-primary"
          onClick={() => (running ? client.pause() : client.play())}
        >
          {running ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="button" onClick={() => client.step()}>
          Step
        </button>
        <button
          type="button"
          className="button"
          onClick={() => client.restartCurrent?.()}
          disabled={client.restartCurrent === undefined}
        >
          Restart
        </button>
      </div>
      <div className="dock-group">
        <label className="field">
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
          className={`achieved ${lagging ? 'is-lagging' : ''}`}
          aria-label="Achieved speed"
          title={lagging ? 'The browser cannot keep up with the requested speed' : undefined}
        >
          {running
            ? achievedSpeed === null
              ? 'achieved —'
              : `achieved ${formatMultiplier(achievedSpeed)}`
            : 'achieved —'}
        </span>
      </div>
      <div className="dock-group segmented" role="group" aria-label="Camera view">
        {VIEWS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="button"
            aria-pressed={view === option.value}
            onClick={() => state.getState().setView(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </footer>
  );
}
