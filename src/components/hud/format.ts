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

const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatInteger(value: number): string {
  return integerFormat.format(value);
}

export function formatPerHour(value: number): string {
  return `${integerFormat.format(value)}/h`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
