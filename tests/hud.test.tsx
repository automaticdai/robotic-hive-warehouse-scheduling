// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, render, screen, fireEvent } from '@testing-library/react';
import { Hud } from '@/components/hud/Hud';
import { createHudStore } from '@/lib/hudStore';

test('renders live metrics and sends run commands', () => {
  const calls: string[] = [];
  const client = { play: () => calls.push('play'), pause: () => calls.push('pause') } as any;
  const state = createHudStore({
    running: false, speed: 1, achievedSpeed: null, simTimeMs: 4000,
    metrics: {
      simTimeMs: 4000, ordersCompleted: 12, jobsCompleted: 30,
      throughputPerHour: 1080, throughputWindowPerHour: 1080,
      completionTimeMs: { mean: 1, p50: 5000, p90: 1, p95: 14000, p99: 1, max: 1 },
      utilisation: { overall: 0.87, idle: 0.13, movingEmpty: 0.2, movingLoaded: 0.3, waiting: 0.2, atStation: 0.17 },
      jobsPending: 7, rejectedAssignments: 0, deadlockEvents: 0, stations: [],
    },
    strategies: ['builtin:fcfs'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke', scenarios: [{ name: 'smoke', config: {} as any }],
    pythonOnline: false, selected: null, inspection: null, error: null,
  });
  render(<Hud client={client} state={state} />);
  expect(screen.getByText('1,080/h')).toBeInTheDocument();
  expect(screen.getByText('87%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /play/i }));
  expect(calls).toEqual(['play']);
});

function makeMetrics(throughputPerHour: number) {
  return {
    simTimeMs: 0,
    ordersCompleted: 0,
    jobsCompleted: 0,
    throughputPerHour,
    throughputWindowPerHour: throughputPerHour,
    completionTimeMs: { mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0 },
    utilisation: {
      overall: 0, idle: 0, movingEmpty: 0, movingLoaded: 0, waiting: 0, atStation: 0,
    },
    jobsPending: 0,
    rejectedAssignments: 0,
    deadlockEvents: 0,
    stations: [],
  };
}

function emptyHudData() {
  return {
    running: false,
    speed: 1,
    achievedSpeed: null,
    simTimeMs: 0,
    metrics: null,
    strategies: ['builtin:fcfs'],
    strategy: 'builtin:fcfs',
    scenarioName: '',
    scenarios: [],
    pythonOnline: false,
    selected: null,
    inspection: null,
    error: null,
  };
}

test('applyMetrics appends and caps throughput history at 120; applyStatus routes metrics', () => {
  const state = createHudStore(emptyHudData());
  for (let i = 0; i < 130; i += 1) {
    state.getState().applyMetrics(makeMetrics(1000 + i));
  }

  const history = state.getState().throughputHistory;
  expect(history).toHaveLength(120);
  expect(history[0]).toBe(1010);
  expect(history.at(-1)).toBe(1129);

  state.getState().applyStatus({
    type: 'status',
    running: true,
    simTimeMs: 5000,
    effectiveSpeed: 2,
    achievedSpeed: 1.5,
    strategy: 'python:auction',
    pythonOnline: true,
    error: null,
    metrics: makeMetrics(42),
  });

  expect(state.getState().running).toBe(true);
  expect(state.getState().simTimeMs).toBe(5000);
  expect(state.getState().speed).toBe(2);
  expect(state.getState().achievedSpeed).toBe(1.5);
  expect(state.getState().strategy).toBe('python:auction');
  expect(state.getState().pythonOnline).toBe(true);
  expect(state.getState().metrics?.throughputPerHour).toBe(42);
  expect(state.getState().throughputHistory).toHaveLength(120);
  expect(state.getState().throughputHistory.at(-1)).toBe(42);
});

test('renders a boot error when no config or metrics exist', () => {
  const client = {} as any;
  const state = createHudStore({
    ...emptyHudData(),
    error: 'Simulation config request failed (500)',
  });
  render(<Hud client={client} state={state} />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Simulation config request failed (500)',
  );
});

test('renders an allocation error and clears it on recovery', () => {
  const client = {} as any;
  const state = createHudStore(emptyHudData());
  render(<Hud client={client} state={state} />);

  act(() => {
    state.getState().applyStatus({
      type: 'status',
      running: true,
      simTimeMs: 0,
      effectiveSpeed: 1,
      achievedSpeed: null,
      strategy: 'python:auction',
      pythonOnline: true,
      error: 'Python sidecar request /sessions/s1/allocate failed: HTTP 500',
      metrics: makeMetrics(10),
    });
  });
  expect(screen.getByRole('alert')).toHaveTextContent('HTTP 500');

  act(() => {
    state.getState().applyStatus({
      type: 'status',
      running: true,
      simTimeMs: 100,
      effectiveSpeed: 1,
      achievedSpeed: 1,
      strategy: 'python:auction',
      pythonOnline: true,
      error: null,
      metrics: makeMetrics(10),
    });
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
