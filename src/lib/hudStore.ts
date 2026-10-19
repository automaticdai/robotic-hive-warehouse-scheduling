import { create } from 'zustand';
import { createStore, type StateCreator, type StoreApi } from 'zustand/vanilla';
import type { SimConfig } from '@/sim/config';
import type { MetricsSummary } from '@/sim/types';
import type { InspectionDetail, InspectionTarget, StatusEvent } from '@/worker/protocol';

/** Commands the HUD sends to the simulation; `SimClient` satisfies this. */
export interface HudClient {
  play(): void;
  pause(): void;
  step(): void;
  setSpeed(speed: number): void;
  selectStrategy(strategy: string): void;
  inspect?(target: InspectionTarget | null): void;
  restart?(config: SimConfig): void;
  /** Restarts the scenario/config that is currently active. */
  restartCurrent?(): void;
}

/** Camera preset for the hive view. */
export type HudView = 'plan' | 'angled';

/** One point of the HUD time series, appended on every status/metrics update. */
export interface HudSample {
  simTimeMs: number;
  throughputPerHour: number;
  jobsPending: number;
}

export interface HudScenario {
  name: string;
  config: SimConfig;
}

/** Data fields accepted by `createHudStore`. */
export interface HudData {
  running: boolean;
  /** Requested speed multiplier. */
  speed: number;
  /** Measured sim-time advance per wall time; null while paused/starting. */
  achievedSpeed: number | null;
  simTimeMs: number;
  metrics: MetricsSummary | null;
  strategies: string[];
  strategy: string;
  scenarioName: string;
  scenarios: HudScenario[];
  pythonOnline: boolean;
  selected: InspectionTarget | null;
  inspection: InspectionDetail | null;
  error: string | null;
  throughputHistory?: number[];
  history?: HudSample[];
  view?: HudView;
}

export interface HudState extends Required<HudData> {
  applyStatus(status: StatusEvent): void;
  applyMetrics(metrics: MetricsSummary): void;
  setSelected(target: InspectionTarget | null): void;
  setStrategy(strategy: string): void;
  setScenario(scenarioName: string): void;
  applyInspection(detail: InspectionDetail | null): void;
  setView(view: HudView): void;
}

/** Number of throughput samples kept for the sparkline. */
export const THROUGHPUT_HISTORY_LIMIT = 120;

function appendThroughput(history: number[], value: number): number[] {
  return [...history, value].slice(-THROUGHPUT_HISTORY_LIMIT);
}

/** Number of time-series samples kept for the HUD charts. */
export const HISTORY_LIMIT = 240;

/**
 * Appends a sample, replacing the last one when sim time has not advanced
 * (status and metrics events often report the same instant). A sample from
 * before the last one means the run restarted, so the series starts over.
 */
function appendSample(history: HudSample[], metrics: MetricsSummary): HudSample[] {
  const sample: HudSample = {
    simTimeMs: metrics.simTimeMs,
    throughputPerHour: metrics.throughputPerHour,
    jobsPending: metrics.jobsPending,
  };
  const last = history.at(-1);
  if (last === undefined || sample.simTimeMs > last.simTimeMs) {
    return [...history, sample].slice(-HISTORY_LIMIT);
  }
  if (sample.simTimeMs === last.simTimeMs) return [...history.slice(0, -1), sample];
  return [sample];
}

function createHudState(initial: HudData): StateCreator<HudState> {
  const { throughputHistory = [], history = [], view = 'plan', ...data } = initial;
  return (set) => ({
    ...data,
    throughputHistory,
    history,
    view,
    setView: (next) => set({ view: next }),
    applyMetrics: (metrics) =>
      set((state) => ({
        metrics,
        throughputHistory: appendThroughput(state.throughputHistory, metrics.throughputPerHour),
        history: appendSample(state.history, metrics),
      })),
    applyStatus: (status) =>
      set((state) => ({
        running: status.running,
        simTimeMs: status.simTimeMs,
        speed: status.effectiveSpeed,
        achievedSpeed: status.achievedSpeed ?? null,
        // The worker acknowledges the active strategy on init/select. A
        // rejected selection reports the previous strategy, not the request.
        strategy: status.strategy ?? state.strategy,
        pythonOnline: status.pythonOnline,
        error: status.error,
        metrics: status.metrics,
        throughputHistory: appendThroughput(
          state.throughputHistory,
          status.metrics.throughputPerHour,
        ),
        history: appendSample(state.history, status.metrics),
      })),
    setSelected: (target) => set({ selected: target, inspection: null }),
    setStrategy: (strategy) => set({ strategy }),
    setScenario: (scenarioName) => set({ scenarioName }),
    applyInspection: (detail) =>
      set((state) => {
        if (detail === null) {
          if (state.inspection === null) return state;
          return { inspection: null };
        }
        // Drop orphan details and details for a target that is no longer (or
        // was never) selected, so a late worker reply cannot overwrite the
        // inspector after the selection changed.
        if (
          state.selected === null ||
          state.selected.type !== detail.type ||
          state.selected.id !== detail.id
        ) {
          return state;
        }
        return { inspection: detail };
      }),
  });
}

/** Creates an isolated HUD store, used by tests and per-page instances. */
export function createHudStore(initial: HudData): StoreApi<HudState> {
  return createStore<HudState>()(createHudState(initial));
}

/** Default application store for the HUD. */
export const useHudStore = create<HudState>()(
  createHudState({
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
  }),
);
