'use client';

import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { STATE_LABELS, stateColor } from '@/components/hive/render';
import type { HudState } from '@/lib/hudStore';

export interface InspectorPanelProps {
  state: StoreApi<HudState>;
}

function row(label: string, value: string) {
  return (
    <div className="inspector-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function cellText(cell: { x: number; y: number } | null | undefined): string {
  return cell ? `${cell.x}, ${cell.y}` : '—';
}

export function InspectorPanel({ state }: InspectorPanelProps) {
  const inspection = useStore(state, (s) => s.inspection);
  const selected = useStore(state, (s) => s.selected);

  return (
    <section className="panel" aria-labelledby="inspector-heading">
      <h2 id="inspector-heading" className="panel-title">
        Inspector
        {selected !== null ? (
          <button
            type="button"
            className="link-button"
            onClick={() => state.getState().setSelected(null)}
          >
            Clear
          </button>
        ) : null}
      </h2>
      {inspection === null ? (
        <p className="placeholder">
          {selected === null
            ? 'Click a robot on the floor, or a station, to follow it.'
            : `Loading ${selected.id}…`}
        </p>
      ) : inspection.type === 'robot' ? (
        <>
          <p className="inspector-title">
            {inspection.id}
            <span className="state-chip">
              <span className="swatch" style={{ backgroundColor: stateColor(inspection.state) }} aria-hidden="true" />
              {STATE_LABELS[inspection.state]}
            </span>
          </p>
          <dl className="inspector-list">
            {row('Job', inspection.jobId ?? '—')}
            {row('Order', inspection.orderId ?? '—')}
            {row('Pod slot', cellText(inspection.pickup))}
            {row('Station', inspection.stationId ?? '—')}
            {row('Carrying', inspection.tripProgress.carrying ? 'Yes' : 'No')}
            {row('Cells to go', String(inspection.tripProgress.pathRemaining))}
            {row('Position', cellText(inspection.cell))}
            {row('Battery', `${Math.round(inspection.battery * 100)}%`)}
          </dl>
        </>
      ) : (
        <>
          <p className="inspector-title">{inspection.id}</p>
          <dl className="inspector-list">
            {row('Queue', `${inspection.queueLength}/${inspection.queueCapacity}`)}
            {row('Picking', inspection.busy ? 'Yes' : 'No')}
            {row('Pick time left', `${(inspection.serviceRemainingMs / 1000).toFixed(1)}s`)}
          </dl>
        </>
      )}
    </section>
  );
}
