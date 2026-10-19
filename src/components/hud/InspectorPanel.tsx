'use client';

import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { HudState } from '@/lib/hudStore';

export interface InspectorPanelProps {
  state: StoreApi<HudState>;
}

function row(label: string, value: string) {
  return (
    <div className="hud-inspector-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function InspectorPanel({ state }: InspectorPanelProps) {
  const inspection = useStore(state, (s) => s.inspection);

  return (
    <section className="hud-panel hud-inspector" aria-label="Inspector">
      <h2 className="hud-panel-title">Inspector</h2>
      {inspection === null ? (
        <p className="hud-placeholder">Select a robot or station</p>
      ) : (
        <dl className="hud-inspector-list">
          {row('ID', inspection.id)}
          {inspection.type === 'robot' ? (
            <>
              {row('State', inspection.state)}
              {row('Battery', `${Math.round(inspection.battery * 100)}%`)}
              {row('Job', inspection.jobId ?? '—')}
              {row('Order', inspection.orderId ?? '—')}
              {row('Station', inspection.stationId ?? '—')}
              {row('Path remaining', String(inspection.tripProgress.pathRemaining))}
              {row('Carrying', inspection.tripProgress.carrying ? 'Yes' : 'No')}
            </>
          ) : (
            <>
              {row('Queue', `${inspection.queueLength}/${inspection.queueCapacity}`)}
              {row('Busy', inspection.busy ? 'Yes' : 'No')}
              {row('Service remaining', `${inspection.serviceRemainingMs}ms`)}
            </>
          )}
        </dl>
      )}
    </section>
  );
}
