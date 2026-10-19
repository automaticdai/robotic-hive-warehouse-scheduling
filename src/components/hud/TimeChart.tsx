'use client';

import { useId, useState, type PointerEvent } from 'react';
import { formatSimClock } from './format';

export interface TimeChartPoint {
  simTimeMs: number;
  value: number;
}

export interface TimeChartProps {
  /** Accessible name, also used as the tooltip series label. */
  label: string;
  points: TimeChartPoint[];
  format(value: number): string;
}

const WIDTH = 260;
const HEIGHT = 84;
const PAD = { top: 10, right: 6, bottom: 16, left: 6 };

/** Rounds a maximum up to 1, 2 or 5 × 10ⁿ so the top gridline is a clean value. */
function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/**
 * Single-series line over sim time with a zero baseline, one top gridline,
 * and a hover crosshair that reads out the nearest sample.
 */
export function TimeChart({ label, points, format }: TimeChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const first = points[0]?.simTimeMs ?? 0;
  const last = points.at(-1)?.simTimeMs ?? 0;
  const span = Math.max(1, last - first);
  const top = niceCeiling(Math.max(0, ...points.map((point) => point.value)));

  const xAt = (time: number) => PAD.left + ((time - first) / span) * plotW;
  const yAt = (value: number) => PAD.top + plotH - (value / top) * plotH;
  const line = points
    .map((point) => `${xAt(point.simTimeMs).toFixed(1)},${yAt(point.value).toFixed(1)}`)
    .join(' ');

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    if (points.length === 0) return;
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const time = first + ratio * span;
    let nearest = 0;
    for (let index = 1; index < points.length; index++) {
      if (Math.abs(points[index]!.simTimeMs - time) < Math.abs(points[nearest]!.simTimeMs - time)) {
        nearest = index;
      }
    }
    setHover(nearest);
  };

  const hovered = hover === null ? null : points[hover] ?? null;
  const latest = points.at(-1) ?? null;

  return (
    <figure className="time-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby={titleId}
        preserveAspectRatio="none"
      >
        <title id={titleId}>{label}</title>
        <line className="time-chart-grid" x1={PAD.left} x2={WIDTH - PAD.right} y1={PAD.top} y2={PAD.top} />
        <line
          className="time-chart-axis"
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
        />
        {points.length > 1 ? <polyline className="time-chart-line" points={line} /> : null}
        {hovered ? (
          <>
            <line
              className="time-chart-crosshair"
              x1={xAt(hovered.simTimeMs)}
              x2={xAt(hovered.simTimeMs)}
              y1={PAD.top}
              y2={PAD.top + plotH}
            />
            <circle
              className="time-chart-dot"
              cx={xAt(hovered.simTimeMs)}
              cy={yAt(hovered.value)}
              r={4}
            />
          </>
        ) : null}
        <rect
          x={0}
          y={0}
          width={WIDTH}
          height={HEIGHT}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      <figcaption className="time-chart-scale">
        <span>{format(top)}</span>
        <span>
          {points.length > 0 ? `${formatSimClock(first)} to ${formatSimClock(last)}` : 'Waiting for samples'}
        </span>
      </figcaption>
      {hovered ? (
        <div
          className="time-chart-tip"
          style={{ left: `${(xAt(hovered.simTimeMs) / WIDTH) * 100}%` }}
          role="status"
        >
          <strong>{format(hovered.value)}</strong>
          <span>at {formatSimClock(hovered.simTimeMs)}</span>
        </div>
      ) : latest ? (
        <span className="visually-hidden">
          {label}: {format(latest.value)}
        </span>
      ) : null}
    </figure>
  );
}
