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

export interface Pod {
  id: string;
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
