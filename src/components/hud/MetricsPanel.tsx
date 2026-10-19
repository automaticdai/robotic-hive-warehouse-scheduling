'use client';

import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { HudState } from '@/lib/hudStore';
import { formatInteger, formatPerHour, formatSeconds } from './format';
import { TimeChart } from './TimeChart';

export interface MetricsPanelProps {
  state: StoreApi<HudState>;
}

/** Order flow: completion rate, how long orders take, and the backlog. */
export function MetricsPanel({ state }: MetricsPanelProps) {
  const metrics = useStore(state, (s) => s.metrics);
  const history = useStore(state, (s) => s.history);

  return (
    <section className="panel" aria-labelledby="orders-heading">
      <h2 id="orders-heading" className="panel-title">Orders</h2>
      <p className="headline">
        <span className="headline-value">{metrics ? formatPerHour(metrics.throughputPerHour) : '—'}</span>
        <span className="headline-caption">completed per hour since start</span>
      </p>
      <dl className="stat-row">
        <div>
          <dt>Done</dt>
          <dd>{metrics ? formatInteger(metrics.ordersCompleted) : '—'}</dd>
        </div>
        <div>
          <dt>Median time</dt>
          <dd>{metrics ? formatSeconds(metrics.completionTimeMs.p50) : '—'}</dd>
        </div>
        <div>
          <dt>p95 time</dt>
          <dd>{metrics ? formatSeconds(metrics.completionTimeMs.p95) : '—'}</dd>
        </div>
      </dl>
      <h3 className="chart-title">Throughput over time</h3>
      <TimeChart
        label="Throughput over time"
        points={history.map((sample) => ({ simTimeMs: sample.simTimeMs, value: sample.throughputPerHour }))}
        format={formatPerHour}
      />
      <h3 className="chart-title">
        Jobs waiting <span className="chart-title-value">{metrics ? formatInteger(metrics.jobsPending) : '—'}</span>
      </h3>
      <TimeChart
        label="Jobs waiting over time"
        points={history.map((sample) => ({ simTimeMs: sample.simTimeMs, value: sample.jobsPending }))}
        format={formatInteger}
      />
    </section>
  );
}
