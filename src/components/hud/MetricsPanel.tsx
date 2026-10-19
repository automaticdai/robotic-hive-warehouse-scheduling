'use client';

import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { HudState } from '@/lib/hudStore';
import { Sparkline } from './Sparkline';

export interface MetricsPanelProps {
  state: StoreApi<HudState>;
}

const throughputFormat = new Intl.NumberFormat('en-US');

function formatThroughput(value: number): string {
  return `${throughputFormat.format(value)}/h`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function MetricsPanel({ state }: MetricsPanelProps) {
  const metrics = useStore(state, (s) => s.metrics);
  const history = useStore(state, (s) => s.throughputHistory);

  return (
    <section className="hud-panel hud-metrics" aria-label="Metrics">
      <h2 className="hud-panel-title">Metrics</h2>
      <dl className="hud-metrics-grid">
        <div className="hud-metric">
          <dt>Throughput</dt>
          <dd>{metrics ? formatThroughput(metrics.throughputPerHour) : '—'}</dd>
        </div>
        <div className="hud-metric">
          <dt>Orders done</dt>
          <dd>{metrics ? metrics.ordersCompleted : '—'}</dd>
        </div>
        <div className="hud-metric">
          <dt>p50</dt>
          <dd>{metrics ? formatSeconds(metrics.completionTimeMs.p50) : '—'}</dd>
        </div>
        <div className="hud-metric">
          <dt>p95</dt>
          <dd>{metrics ? formatSeconds(metrics.completionTimeMs.p95) : '—'}</dd>
        </div>
        <div className="hud-metric">
          <dt>Utilisation</dt>
          <dd>{metrics ? formatPercent(metrics.utilisation.overall) : '—'}</dd>
        </div>
        <div className="hud-metric">
          <dt>Jobs pending</dt>
          <dd>{metrics ? metrics.jobsPending : '—'}</dd>
        </div>
      </dl>
      <Sparkline values={history} />
    </section>
  );
}
