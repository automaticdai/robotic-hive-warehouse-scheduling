'use client';

import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { HudState } from '@/lib/hudStore';
import type { Snapshot } from '@/sim/simulation';
import { formatPercent } from './format';

export interface StationsPanelProps {
  state: StoreApi<HudState>;
  snapshot: Snapshot | null;
}

/**
 * One row per pick station: live queue as filled slots out of capacity,
 * whether a pod is being picked right now, and long-run busy share. Rows
 * select the station for the inspector and highlight its port zone.
 */
export function StationsPanel({ state, snapshot }: StationsPanelProps) {
  const metrics = useStore(state, (s) => s.metrics);
  const selected = useStore(state, (s) => s.selected);
  const live = snapshot?.stations ?? [];
  const summaryById = new Map((metrics?.stations ?? []).map((station) => [station.id, station]));

  return (
    <section className="panel" aria-labelledby="stations-heading">
      <h2 id="stations-heading" className="panel-title">Pick stations</h2>
      {live.length === 0 ? (
        <p className="placeholder">Stations appear once the run starts.</p>
      ) : (
        <ul className="station-list">
          {live.map((station) => {
            const summary = summaryById.get(station.id);
            const isSelected = selected?.type === 'station' && selected.id === station.id;
            const full = station.queueLength >= station.capacity;
            return (
              <li key={station.id}>
                <button
                  type="button"
                  className="station-row"
                  aria-pressed={isSelected}
                  onClick={() =>
                    state.getState().setSelected(isSelected ? null : { type: 'station', id: station.id })
                  }
                >
                  <span className="station-row-head">
                    <span className="station-id">{station.id}</span>
                    <span className={`station-status ${station.busy ? 'is-busy' : ''}`}>
                      {station.busy ? 'Picking' : 'Waiting for pods'}
                    </span>
                  </span>
                  <span
                    className="slots"
                    role="img"
                    aria-label={`Queue ${station.queueLength} of ${station.capacity}`}
                  >
                    {Array.from({ length: station.capacity }, (_, index) => (
                      <span key={index} className={index < station.queueLength ? `slot is-filled${full ? ' is-full' : ''}` : 'slot'} />
                    ))}
                  </span>
                  <span className="station-row-foot">
                    <span>
                      Queue {station.queueLength}/{station.capacity}
                      {full ? ', full' : ''}
                    </span>
                    <span>{summary ? `busy ${formatPercent(summary.busyFraction)} of the time` : ''}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
