'use client';

import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { HudState } from '@/lib/hudStore';

export interface TopBarProps {
  state: StoreApi<HudState>;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Formats simulation milliseconds as `HH:MM:SS`. */
export function formatSimClock(simTimeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(simTimeMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function TopBar({ state }: TopBarProps) {
  const scenarioName = useStore(state, (s) => s.scenarioName);
  const strategy = useStore(state, (s) => s.strategy);
  const simTimeMs = useStore(state, (s) => s.simTimeMs);
  const pythonOnline = useStore(state, (s) => s.pythonOnline);

  return (
    <header className="hud-panel hud-topbar">
      <span className="hud-brand">HIVE-1</span>
      <span className="hud-topbar-item">{scenarioName || '—'}</span>
      <span className="hud-topbar-item">{strategy}</span>
      <span
        className={`hud-python ${pythonOnline ? 'hud-python-online' : 'hud-python-offline'}`}
      >
        {pythonOnline ? 'Python online' : 'Python offline — FCFS only'}
      </span>
      <span className="hud-clock">t+ {formatSimClock(simTimeMs)}</span>
    </header>
  );
}
