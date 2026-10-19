'use client';

import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { ROBOT_STATUS_ORDER, STATE_LABELS, stateColor } from '@/components/hive/render';
import type { HudState } from '@/lib/hudStore';
import type { Snapshot } from '@/sim/simulation';
import type { MetricsSummary } from '@/sim/types';
import { formatInteger, formatPercent } from './format';

export interface FleetPanelProps {
  state: StoreApi<HudState>;
  snapshot: Snapshot | null;
}

const TIME_SHARE: Record<(typeof ROBOT_STATUS_ORDER)[number], keyof MetricsSummary['utilisation']> = {
  idle: 'idle',
  moving_empty: 'movingEmpty',
  moving_loaded: 'movingLoaded',
  waiting: 'waiting',
  at_station: 'atStation',
};

/**
 * What the fleet is doing now (live counts from the latest snapshot) and how
 * robot time has been spent since the start (from the metrics summary). The
 * stacked bar and the list share one colour per state.
 */
export function FleetPanel({ state, snapshot }: FleetPanelProps) {
  const metrics = useStore(state, (s) => s.metrics);

  const counts = ROBOT_STATUS_ORDER.map(() => 0);
  if (snapshot) for (const code of snapshot.robots.state) counts[code] = (counts[code] ?? 0) + 1;
  const total = snapshot?.robots.state.length ?? 0;

  return (
    <section className="panel" aria-labelledby="fleet-heading">
      <h2 id="fleet-heading" className="panel-title">
        Fleet <span className="panel-title-aside">{total > 0 ? `${formatInteger(total)} robots` : ''}</span>
      </h2>
      <p className="headline">
        <span className="headline-value">{metrics ? formatPercent(metrics.utilisation.overall) : '—'}</span>
        <span className="headline-caption">of robot time spent working</span>
      </p>
      <div className="stack-bar" role="img" aria-label="Robots by current state">
        {ROBOT_STATUS_ORDER.map((status, index) =>
          total > 0 && counts[index]! > 0 ? (
            <span
              key={status}
              style={{ flexGrow: counts[index], backgroundColor: stateColor(status) }}
              title={`${STATE_LABELS[status]}: ${counts[index]}`}
            />
          ) : null,
        )}
      </div>
      <table className="fleet-table">
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col">Now</th>
            <th scope="col">Time share</th>
          </tr>
        </thead>
        <tbody>
          {ROBOT_STATUS_ORDER.map((status, index) => (
            <tr key={status}>
              <th scope="row">
                <span className="swatch" style={{ backgroundColor: stateColor(status) }} aria-hidden="true" />
                {STATE_LABELS[status]}
              </th>
              <td>{total > 0 ? formatInteger(counts[index]!) : '—'}</td>
              <td>{metrics ? `${(metrics.utilisation[TIME_SHARE[status]] * 100).toFixed(1)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
