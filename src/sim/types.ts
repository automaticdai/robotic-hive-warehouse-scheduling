import type { Cell, SimConfig } from './config';
import type { Rng } from './rng';

export type RobotStatus =
  | 'idle'
  | 'moving_empty'
  | 'moving_loaded'
  | 'waiting'
  | 'at_station';

export interface Robot {
  id: string;
  cell: Cell;
  status: RobotStatus;
  battery: number;
  jobId: string | null;
  carrying: boolean;
  path: Cell[];
  assignedAtMs: number;
  blockedTicks: number;
}

/** Numeric pod-state encoding used by snapshot consumers. */
export const POD_STATE_CODE = { stored: 0, reserved: 1, out: 2 } as const;

export interface Pod {
  id: string;
  /** Fixed home slot in the storage block; pods never change slot. */
  cell: Cell;
  available: boolean;
  reservedByJobId: string | null;
  replenishAtMs: number | null;
}

export interface QueuedPod {
  podId: string;
  orderId: string;
  jobId: string;
}

export interface Station {
  id: string;
  docks: Cell[];
  queueCapacity: number;
  serviceTimeMs: number;
  queue: QueuedPod[];
  serviceRemainingMs: number;
}

export type JobStatus = 'pending' | 'ready' | 'assigned' | 'complete';

export interface Job {
  id: string;
  orderId: string;
  podId: string;
  pickup: Cell;
  candidateStations: string[];
  dependsOn: string[];
  priority: number;
  createdAtMs: number;
  status: JobStatus;
  stationId: string | null;
  robotId: string | null;
  completedAtMs: number | null;
}

export interface Order {
  id: string;
  createdAtMs: number;
  jobIds: string[];
  stationId: string | null;
  podsTotal: number;
  podsServiced: number;
  packingRemainingMs: number | null;
  completedAtMs: number | null;
}

export interface World {
  config: SimConfig;
  simTimeMs: number;
  tick: number;
  robots: Robot[];
  pods: Pod[];
  stations: Station[];
  jobs: Map<string, Job>;
  orders: Map<string, Order>;
  rng: Rng;
}

export interface MetricsSample {
  simTimeMs: number;
  ordersCompleted: number;
  jobsCompleted: number;
  throughputPerHour: number;
  utilisation: number;
  pendingJobs: number;
  avgQueueLength: number;
}

export interface MetricsSummary {
  simTimeMs: number;
  ordersCompleted: number;
  jobsCompleted: number;
  throughputPerHour: number;
  throughputWindowPerHour: number;
  completionTimeMs: {
    mean: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
    max: number;
  };
  utilisation: {
    overall: number;
    idle: number;
    movingEmpty: number;
    movingLoaded: number;
    waiting: number;
    atStation: number;
  };
  jobsPending: number;
  rejectedAssignments: number;
  deadlockEvents: number;
  stations: {
    id: string;
    busyFraction: number;
    avgQueueLength: number;
    maxQueueLength: number;
  }[];
}
