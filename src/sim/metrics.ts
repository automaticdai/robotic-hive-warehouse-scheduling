import type { MetricsSample } from './types';

/**
 * Linear-interpolated percentile over a numeric copy of `values`. The index is
 * `(n - 1) * p / 100`; empty input yields 0.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = ((sorted.length - 1) * p) / 100;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;

  const weight = index - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * weight;
}

const CSV_HEADER =
  'simTimeMs,ordersCompleted,jobsCompleted,throughputPerHour,utilisation,pendingJobs,avgQueueLength';

/** Serialises time-series samples; utilisation keeps 4 and throughput 2 decimals. */
export function toCsv(samples: MetricsSample[]): string {
  const lines = [CSV_HEADER];
  for (const sample of samples) {
    lines.push(
      [
        sample.simTimeMs,
        sample.ordersCompleted,
        sample.jobsCompleted,
        sample.throughputPerHour.toFixed(2),
        sample.utilisation.toFixed(4),
        sample.pendingJobs,
        sample.avgQueueLength,
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
