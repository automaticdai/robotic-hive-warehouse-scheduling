// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, render, screen, fireEvent } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { Hud } from '@/components/hud/Hud';
import { useSimConnection } from '@/components/hud/useSimConnection';
import { createHudStore, useHudStore } from '@/lib/hudStore';
import { SnapshotSource } from '@/lib/snapshotSource';

function zeroMetrics() {
  return {
    simTimeMs: 0,
    ordersCompleted: 0,
    jobsCompleted: 0,
    throughputPerHour: 0,
    throughputWindowPerHour: 0,
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

test('selecting a strategy hot-swaps it', () => {
  const calls: string[] = [];
  const client = { selectStrategy: (id: string) => calls.push(id) } as any;
  const state = createHudStore({
    running: true, speed: 1, achievedSpeed: null, simTimeMs: 0, metrics: null,
    strategies: ['builtin:fcfs', 'python:auction'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke', scenarios: [{ name: 'smoke', config: {} as any }],
    pythonOnline: true, selected: null, inspection: null, error: null,
  });
  render(<Hud client={client} state={state} />);
  fireEvent.change(screen.getByLabelText(/algorithm/i), { target: { value: 'python:auction' } });
  expect(calls).toEqual(['python:auction']);
  // The label waits for the worker's acknowledgement rather than assuming
  // the selection succeeded.
  expect(state.getState().strategy).toBe('builtin:fcfs');

  act(() => {
    state.getState().applyStatus({
      type: 'status', running: true, simTimeMs: 0, effectiveSpeed: 1,
      achievedSpeed: null, strategy: 'python:auction', pythonOnline: true,
      error: null, metrics: zeroMetrics(),
    });
  });
  expect(state.getState().strategy).toBe('python:auction');
  expect(screen.getByLabelText(/algorithm/i)).toHaveValue('python:auction');
});

test('a rejected strategy keeps the active label and surfaces the error', () => {
  const client = { selectStrategy: () => undefined } as any;
  const state = createHudStore({
    running: true, speed: 1, achievedSpeed: null, simTimeMs: 0, metrics: null,
    strategies: ['builtin:fcfs', 'python:auction'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke', scenarios: [{ name: 'smoke', config: {} as any }],
    pythonOnline: true, selected: null, inspection: null, error: null,
  });
  render(<Hud client={client} state={state} />);
  fireEvent.change(screen.getByLabelText(/algorithm/i), { target: { value: 'python:auction' } });

  // The worker acknowledges the still-active strategy together with the error.
  act(() => {
    state.getState().applyStatus({
      type: 'status', running: true, simTimeMs: 0, effectiveSpeed: 1,
      achievedSpeed: null, strategy: 'builtin:fcfs', pythonOnline: true,
      error: 'Cannot create allocator for "python:auction": the Python sidecar is offline',
      metrics: zeroMetrics(),
    });
  });

  expect(screen.getByLabelText(/algorithm/i)).toHaveValue('builtin:fcfs');
  expect(screen.getByRole('alert')).toHaveTextContent('sidecar is offline');
});

test('restarts the currently active scenario without reselecting it', () => {
  const restarts: string[] = [];
  const client = { restartCurrent: () => restarts.push('restart') } as any;
  const state = createHudStore({
    running: true, speed: 1, achievedSpeed: null, simTimeMs: 0, metrics: null,
    strategies: ['builtin:fcfs'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke', scenarios: [{ name: 'smoke', config: {} as any }],
    pythonOnline: false, selected: null, inspection: null, error: null,
  });
  render(<Hud client={client} state={state} />);
  fireEvent.click(screen.getByRole('button', { name: /restart/i }));
  expect(restarts).toEqual(['restart']);
});

test('renders achieved speed distinctly and warns when it lags the target', () => {
  const client = {} as any;
  const state = createHudStore({
    running: true, speed: 4, achievedSpeed: 1.2, simTimeMs: 0, metrics: null,
    strategies: ['builtin:fcfs'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke', scenarios: [{ name: 'smoke', config: {} as any }],
    pythonOnline: false, selected: null, inspection: null, error: null,
  });
  render(<Hud client={client} state={state} />);

  const achieved = screen.getByLabelText('Achieved speed');
  expect(achieved).toHaveTextContent('achieved 1.2×');
  expect(achieved).toHaveClass('hud-achieved-lagging');
  expect(screen.getByLabelText('Speed')).toHaveValue('4');
});

test('does not show an achieved speed while paused', () => {
  const client = {} as any;
  const state = createHudStore({
    running: false, speed: 2, achievedSpeed: null, simTimeMs: 0, metrics: null,
    strategies: ['builtin:fcfs'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke', scenarios: [{ name: 'smoke', config: {} as any }],
    pythonOnline: false, selected: null, inspection: null, error: null,
  });
  render(<Hud client={client} state={state} />);
  expect(screen.getByLabelText('Achieved speed')).toHaveTextContent('achieved —');
});

test('clicking a station asks the worker to inspect it', () => {
  const calls: any[] = [];
  const client = { inspect: (target: any) => calls.push(target) } as any;
  const state = createHudStore({
    running: true, speed: 1, achievedSpeed: null, simTimeMs: 0, metrics: null,
    strategies: ['builtin:fcfs'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke', scenarios: [{ name: 'smoke', config: {} as any }],
    pythonOnline: false, selected: null, inspection: null, error: null,
  });
  render(<Hud client={client} state={state} />);
  state.getState().setSelected({ type: 'station', id: 'S-1' });
  expect(calls).toEqual([{ type: 'station', id: 'S-1' }]);
});

const robotDetail = {
  type: 'robot' as const,
  id: 'R-1',
  state: 'idle' as const,
  battery: 1,
  jobId: null,
  orderId: null,
  stationId: null,
  tripProgress: { pathRemaining: 0, carrying: false },
};

const stationDetail = {
  type: 'station' as const,
  id: 'S-1',
  queueLength: 2,
  queueCapacity: 8,
  busy: true,
  serviceRemainingMs: 5000,
};

function inspectionStore() {
  return createHudStore({
    running: true, speed: 1, achievedSpeed: null, simTimeMs: 0, metrics: null,
    strategies: ['builtin:fcfs'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke', scenarios: [{ name: 'smoke', config: {} as any }],
    pythonOnline: false, selected: null, inspection: null, error: null,
  });
}

test('applyInspection stores only a detail matching the selected target', () => {
  const state = inspectionStore();

  // Orphan detail (nothing selected) is ignored.
  state.getState().applyInspection(robotDetail);
  expect(state.getState().inspection).toBeNull();

  state.getState().setSelected({ type: 'robot', id: 'R-1' });
  state.getState().applyInspection(robotDetail);
  expect(state.getState().inspection).toEqual(robotDetail);

  // Mismatched type and mismatched id are both ignored.
  state.getState().applyInspection(stationDetail);
  expect(state.getState().inspection).toEqual(robotDetail);
  state.getState().applyInspection({ ...robotDetail, id: 'R-2' });
  expect(state.getState().inspection).toEqual(robotDetail);

  // Explicit null clears.
  state.getState().applyInspection(null);
  expect(state.getState().inspection).toBeNull();
});

test('changing the scenario restarts with the named config', () => {
  const smoke = { seed: 1 } as any;
  const rush = { seed: 2 } as any;
  const restarts: any[] = [];
  const client = { restart: (config: any) => restarts.push(config) } as any;
  const state = createHudStore({
    running: true, speed: 1, achievedSpeed: null, simTimeMs: 0, metrics: null,
    strategies: ['builtin:fcfs'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke',
    scenarios: [{ name: 'smoke', config: smoke }, { name: 'rush', config: rush }],
    pythonOnline: false, selected: null, inspection: null, error: null,
  });
  render(<Hud client={client} state={state} />);
  fireEvent.change(screen.getByLabelText(/scenario/i), { target: { value: 'rush' } });
  expect(restarts).toEqual([rush]);
  expect(state.getState().scenarioName).toBe('rush');
});

test('renders a scenario option for the current name when it is not loaded', () => {
  const client = {} as any;
  const state = createHudStore({
    running: true, speed: 1, achievedSpeed: null, simTimeMs: 0, metrics: null,
    strategies: ['builtin:fcfs'], strategy: 'builtin:fcfs',
    scenarioName: 'default', scenarios: [{ name: 'smoke', config: {} as any }],
    pythonOnline: false, selected: null, inspection: null, error: null,
  });
  render(<Hud client={client} state={state} />);
  const select = screen.getByLabelText(/scenario/i);
  expect(select).toHaveValue('default');
  expect(screen.getByRole('option', { name: 'default' })).toBeInTheDocument();
});

test('renders the Python status badge from the store', () => {
  const client = {} as any;
  const base = {
    running: true, speed: 1, achievedSpeed: null, simTimeMs: 0, metrics: null,
    strategies: ['builtin:fcfs'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke', scenarios: [{ name: 'smoke', config: {} as any }],
    selected: null, inspection: null, error: null,
  };
  const online = createHudStore({ ...base, pythonOnline: true });
  render(<Hud client={client} state={online} />);
  expect(screen.getByText('Python online')).toBeInTheDocument();
});

test('renders the offline Python badge', () => {
  const client = {} as any;
  const state = createHudStore({
    running: true, speed: 1, achievedSpeed: null, simTimeMs: 0, metrics: null,
    strategies: ['builtin:fcfs'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke', scenarios: [{ name: 'smoke', config: {} as any }],
    pythonOnline: false, selected: null, inspection: null, error: null,
  });
  render(<Hud client={client} state={state} />);
  expect(screen.getByText('Python offline — FCFS only')).toBeInTheDocument();
});

test('useSimConnection feeds snapshots, status, and inspections then detaches', () => {
  const handlers: Record<string, any> = {};
  const detached: string[] = [];
  const client = {
    onSnapshot: (callback: any) => {
      handlers.snapshot = callback;
      return () => detached.push('snapshot');
    },
    onStatus: (callback: any) => {
      handlers.status = callback;
      return () => detached.push('status');
    },
    onInspection: (callback: any) => {
      handlers.inspection = callback;
      return () => detached.push('inspection');
    },
  } as any;
  const source = new SnapshotSource();
  const { unmount } = renderHook(() => useSimConnection(client, source));

  const snapshot = { timeMs: 7 } as any;
  handlers.snapshot(snapshot);
  expect(source.latest()).toBe(snapshot);

  handlers.status({
    type: 'status',
    running: true,
    simTimeMs: 10,
    effectiveSpeed: 2,
    pythonOnline: true,
    error: null,
    metrics: { throughputPerHour: 12 } as any,
  });
  expect(useHudStore.getState().running).toBe(true);
  expect(useHudStore.getState().pythonOnline).toBe(true);

  useHudStore.getState().setSelected({ type: 'robot', id: 'R-1' });
  handlers.inspection({ type: 'robot', id: 'R-1' }, robotDetail);
  expect(useHudStore.getState().inspection).toEqual(robotDetail);
  handlers.inspection({ type: 'robot', id: 'R-1' }, null);
  expect(useHudStore.getState().inspection).toBeNull();

  unmount();
  expect(detached.sort()).toEqual(['inspection', 'snapshot', 'status']);
});

test('setSelected clears stale inspection on reselection and clearing', () => {
  const state = inspectionStore();
  state.getState().setSelected({ type: 'robot', id: 'R-1' });
  state.getState().applyInspection(robotDetail);
  expect(state.getState().inspection).toEqual(robotDetail);

  state.getState().setSelected({ type: 'station', id: 'S-1' });
  expect(state.getState().selected).toEqual({ type: 'station', id: 'S-1' });
  expect(state.getState().inspection).toBeNull();

  state.getState().applyInspection(stationDetail);
  expect(state.getState().inspection).toEqual(stationDetail);

  state.getState().setSelected(null);
  expect(state.getState().selected).toBeNull();
  expect(state.getState().inspection).toBeNull();
});
