const WIDTH = 120;
const HEIGHT = 28;
const PADDING = 1;

export interface SparklineProps {
  values: number[];
}

/** Inline SVG throughput sparkline; the last 120 samples fit a 120×28 viewBox. */
export function Sparkline({ values }: SparklineProps) {
  const usableHeight = HEIGHT - PADDING * 2;
  let points = '';

  if (values.length > 1) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = WIDTH / (values.length - 1);
    points = values
      .map((value, index) => {
        const x = index * stepX;
        const y = PADDING + usableHeight - ((value - min) / range) * usableHeight;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }

  return (
    <svg
      className="hud-sparkline"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      role="img"
      aria-label="Throughput history"
    >
      {values.length > 1 ? (
        <polyline points={points} fill="none" stroke="#d8e8e2" strokeWidth={1.5} />
      ) : null}
      {values.length === 1 ? (
        <circle cx={WIDTH} cy={HEIGHT / 2} r={1.5} fill="#d8e8e2" />
      ) : null}
    </svg>
  );
}
