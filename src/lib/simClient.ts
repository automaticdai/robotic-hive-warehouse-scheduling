import type { SimConfig } from '@/sim/config';
import type { MetricsSummary, Snapshot } from '@/sim/simulation';
import { decodeSnapshotEvent } from '@/worker/protocol';
import type {
  InspectionDetail,
  InspectionTarget,
  InitOptions,
  ReadyEvent,
  StatusEvent,
  WorkerCommand,
  WorkerEvent,
} from '@/worker/protocol';

export type { InspectionDetail, InspectionTarget } from '@/worker/protocol';

/** Minimal surface shared by `Worker` and test doubles. */
export interface WorkerLike {
  postMessage(message: WorkerCommand): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener?(type: 'message', listener: (event: MessageEvent) => void): void;
  terminate(): void;
}

export type SnapshotCallback = (snapshot: Snapshot) => void;
export type MetricsCallback = (metrics: MetricsSummary) => void;
export type StatusCallback = (status: StatusEvent) => void;
export type InspectionCallback = (
  target: InspectionTarget,
  detail: InspectionDetail | null,
) => void;
export type ReadyCallback = (event: ReadyEvent) => void;

/**
 * Typed façade over the simulation Web Worker. Attaches a single message
 * listener, decodes snapshot buffers, and fans events out to subscribers.
 */
export class SimClient {
  private readonly worker: WorkerLike;
  private readonly listener: (event: MessageEvent) => void;

  private config: SimConfig | null = null;
  private options: InitOptions | null = null;
  private disposed = false;

  private readonly snapshotCallbacks = new Set<SnapshotCallback>();
  private readonly metricsCallbacks = new Set<MetricsCallback>();
  private readonly statusCallbacks = new Set<StatusCallback>();
  private readonly inspectionCallbacks = new Set<InspectionCallback>();
  private readonly readyCallbacks = new Set<ReadyCallback>();

  constructor(worker: WorkerLike) {
    this.worker = worker;
    this.listener = (event) => this.handleMessage(event.data as WorkerEvent);
    this.worker.addEventListener('message', this.listener);
  }

  get currentConfig(): SimConfig | null {
    return this.config;
  }

  get currentOptions(): InitOptions | null {
    return this.options;
  }

  init(config: SimConfig, options: InitOptions): void {
    this.config = config;
    this.options = options;
    this.post({ type: 'init', config, options });
  }

  play(): void {
    this.post({ type: 'play' });
  }

  pause(): void {
    this.post({ type: 'pause' });
  }

  step(): void {
    this.post({ type: 'step' });
  }

  setSpeed(speed: number): void {
    this.post({ type: 'setSpeed', speed });
  }

  selectStrategy(strategy: string): void {
    this.post({ type: 'selectStrategy', strategy });
  }

  restart(config: SimConfig): void {
    this.config = config;
    this.post({ type: 'restart', config });
  }

  inspect(target: InspectionTarget | null): void {
    this.post({ type: 'inspect', target });
  }

  onSnapshot(callback: SnapshotCallback): () => void {
    this.snapshotCallbacks.add(callback);
    return () => {
      this.snapshotCallbacks.delete(callback);
    };
  }

  onMetrics(callback: MetricsCallback): () => void {
    this.metricsCallbacks.add(callback);
    return () => {
      this.metricsCallbacks.delete(callback);
    };
  }

  onStatus(callback: StatusCallback): () => void {
    this.statusCallbacks.add(callback);
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  onInspection(callback: InspectionCallback): () => void {
    this.inspectionCallbacks.add(callback);
    return () => {
      this.inspectionCallbacks.delete(callback);
    };
  }

  onReady(callback: ReadyCallback): () => void {
    this.readyCallbacks.add(callback);
    return () => {
      this.readyCallbacks.delete(callback);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener?.('message', this.listener);
    this.worker.terminate();
    this.snapshotCallbacks.clear();
    this.metricsCallbacks.clear();
    this.statusCallbacks.clear();
    this.inspectionCallbacks.clear();
    this.readyCallbacks.clear();
  }

  private post(command: WorkerCommand): void {
    if (this.disposed) return;
    this.worker.postMessage(command);
  }

  private handleMessage(event: WorkerEvent): void {
    switch (event.type) {
      case 'snapshot': {
        const snapshot = decodeSnapshotEvent(event);
        this.notify(this.snapshotCallbacks, snapshot);
        break;
      }
      case 'status': {
        this.notify(this.statusCallbacks, event);
        this.notify(this.metricsCallbacks, event.metrics);
        break;
      }
      case 'inspection': {
        this.notify(this.inspectionCallbacks, event.target, event.detail);
        break;
      }
      case 'ready': {
        this.notify(this.readyCallbacks, event);
        break;
      }
    }
  }

  /**
   * Dispatches to subscribers one at a time so a throwing subscriber cannot
   * prevent the remaining subscribers from receiving the event.
   */
  private notify<T extends unknown[]>(
    callbacks: Set<(...args: T) => void>,
    ...args: T
  ): void {
    for (const callback of callbacks) {
      try {
        callback(...args);
      } catch {
        // A subscriber failure is local to that subscriber.
      }
    }
  }
}

/**
 * Constructs the module worker. Kept behind a function so importing this
 * module (for example from Node tests) never instantiates a Worker.
 */
export function createSimWorker(): WorkerLike {
  return new Worker(new URL('../worker/sim.worker.ts', import.meta.url), {
    type: 'module',
  });
}
