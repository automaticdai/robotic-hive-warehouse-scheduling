import type { Cell } from './config';
import type { RobotStatus } from './types';

export interface RobotObservation {
  id: string;
  cell: Cell;
  status: RobotStatus;
  battery: number;
  jobId: string | null;
}

export interface JobObservation {
  id: string;
  orderId: string;
  podId: string;
  pickup: Cell;
  candidateStations: string[];
  priority: number;
  createdAtMs: number;
  dependsOn: string[];
}

export interface StationObservation {
  id: string;
  queueLength: number;
  queueCapacity: number;
  serviceTimeMs: number;
  busy: boolean;
  /**
   * Dock cells, when the caller can supply them. The brief's observation type
   * omits docks while FCFS is specified to score pickup-to-nearest-dock
   * distance, so this stays optional: `Simulation.observe()` fills it and
   * allocators fall back to a zero distance when it is absent.
   */
  docks?: Cell[];
}

export interface AllocationObservation {
  simTimeMs: number;
  allocationSeq: number;
  robots: RobotObservation[];
  jobs: JobObservation[];
  stations: StationObservation[];
}

export interface Assignment {
  jobId: string;
  robotId: string;
  stationId: string;
}

export type RejectReason =
  | 'stale' | 'unknown-job' | 'job-not-ready' | 'unknown-robot'
  | 'robot-not-idle' | 'unknown-station' | 'station-not-candidate'
  | 'duplicate-job' | 'duplicate-robot' | 'station-frozen';

export interface RejectedAssignment {
  assignment: Assignment;
  reason: RejectReason;
}

export interface ApplyResult {
  accepted: number;
  rejected: RejectedAssignment[];
  stale: boolean;
}

/** Strategy contract: may answer synchronously or asynchronously. */
export interface Allocator {
  allocate(observation: AllocationObservation): Promise<Assignment[]> | Assignment[];
}
