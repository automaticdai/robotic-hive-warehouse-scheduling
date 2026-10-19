import type { Cell, SimConfig } from '@/sim/config';
import type { RobotStatus } from '@/sim/types';
import type { MetricsSummary, Snapshot } from '@/sim/simulation';

/** Snapshot metadata that travels without transferable buffers. */
export interface SnapshotMeta {
  timeMs: number;
  robotIds: string[];
  stations: Snapshot['stations'];
  metrics: MetricsSummary;
}

/**
 * A snapshot split into transferable buffers. The buffer order is fixed:
 * robots.x, robots.y, robots.state, robots.carrying, robots.battery,
 * pods.x, pods.y, pods.visible, pods.state.
 */
export interface SerializedSnapshot {
  meta: SnapshotMeta;
  buffers: ArrayBuffer[];
}

const BUFFER_COUNT = 9;

export interface InspectionTarget {
  type: 'robot' | 'station';
  id: string;
}

export interface RobotInspectionDetail {
  type: 'robot';
  id: string;
  state: RobotStatus;
  battery: number;
  jobId: string | null;
  orderId: string | null;
  stationId: string | null;
  tripProgress: {
    pathRemaining: number;
    carrying: boolean;
  };
  /** Current cell and remaining route, for drawing the trip in the scene. */
  cell?: Cell;
  path?: Cell[];
  /** Home slot of the pod this robot is fetching or carrying. */
  pickup?: Cell | null;
}

export interface StationInspectionDetail {
  type: 'station';
  id: string;
  queueLength: number;
  queueCapacity: number;
  busy: boolean;
  serviceRemainingMs: number;
}

export type InspectionDetail = RobotInspectionDetail | StationInspectionDetail;

export interface InitOptions {
  strategy: string;
  pythonUrl: string | null;
  speed: number;
}

export type WorkerCommand =
  | { type: 'init'; config: SimConfig; options: InitOptions }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'step' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'selectStrategy'; strategy: string }
  | { type: 'restart'; config: SimConfig }
  | { type: 'inspect'; target: InspectionTarget | null };

export interface ReadyEvent {
  type: 'ready';
  robotIds: string[];
  stationIds: string[];
}

export interface StatusEvent {
  type: 'status';
  running: boolean;
  simTimeMs: number;
  /** Requested (clamped) speed multiplier. */
  effectiveSpeed: number;
  /** Measured sim-time advance per wall time, or null while paused/starting. */
  achievedSpeed?: number | null;
  /** Allocator that is actually active, acknowledging init/select. */
  strategy?: string;
  pythonOnline: boolean;
  error: string | null;
  metrics: MetricsSummary;
}

export interface SnapshotEvent {
  type: 'snapshot';
  meta: SnapshotMeta;
  buffers: ArrayBuffer[];
  metrics: MetricsSummary;
}

export interface InspectionEvent {
  type: 'inspection';
  target: InspectionTarget;
  detail: InspectionDetail | null;
}

export type WorkerEvent = ReadyEvent | StatusEvent | SnapshotEvent | InspectionEvent;

/** Raised when a worker message does not match the protocol. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/**
 * Splits a snapshot into metadata plus transferable buffers. The typed arrays
 * are not copied: the simulation allocates fresh arrays for every snapshot, and
 * callers must not reuse them after the buffers are transferred.
 */
export function encodeSnapshot(snapshot: Snapshot): SerializedSnapshot {
  return {
    meta: {
      timeMs: snapshot.timeMs,
      robotIds: [...snapshot.robotIds],
      stations: snapshot.stations,
      metrics: snapshot.metrics,
    },
    buffers: [
      snapshot.robots.x.buffer as ArrayBuffer,
      snapshot.robots.y.buffer as ArrayBuffer,
      snapshot.robots.state.buffer as ArrayBuffer,
      snapshot.robots.carrying.buffer as ArrayBuffer,
      snapshot.robots.battery.buffer as ArrayBuffer,
      snapshot.pods.x.buffer as ArrayBuffer,
      snapshot.pods.y.buffer as ArrayBuffer,
      snapshot.pods.visible.buffer as ArrayBuffer,
      snapshot.pods.state.buffer as ArrayBuffer,
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateMeta(meta: unknown): SnapshotMeta {
  if (!isRecord(meta)) throw new ProtocolError('Snapshot meta must be an object');
  if (!isFiniteNumber(meta.timeMs)) {
    throw new ProtocolError('Snapshot meta.timeMs must be a finite number');
  }
  if (!Array.isArray(meta.robotIds) || !meta.robotIds.every((id) => typeof id === 'string')) {
    throw new ProtocolError('Snapshot meta.robotIds must be a string array');
  }
  if (!Array.isArray(meta.stations)) {
    throw new ProtocolError('Snapshot meta.stations must be an array');
  }
  for (const station of meta.stations) {
    if (
      !isRecord(station) ||
      typeof station.id !== 'string' ||
      !isFiniteNumber(station.queueLength) ||
      !isFiniteNumber(station.capacity) ||
      typeof station.busy !== 'boolean'
    ) {
      throw new ProtocolError('Snapshot meta.stations contains a malformed entry');
    }
  }
  if (!isRecord(meta.metrics)) {
    throw new ProtocolError('Snapshot meta.metrics must be an object');
  }
  return meta as unknown as SnapshotMeta;
}

function validateBuffers(buffers: unknown, robotIds: string[]): ArrayBuffer[] {
  if (!Array.isArray(buffers) || buffers.length !== BUFFER_COUNT) {
    throw new ProtocolError(
      `Snapshot event must carry exactly ${BUFFER_COUNT} buffers`,
    );
  }
  for (const buffer of buffers) {
    if (!(buffer instanceof ArrayBuffer)) {
      throw new ProtocolError('Snapshot buffers must be ArrayBuffers');
    }
  }

  const robotCount = robotIds.length;
  for (let index = 0; index < 5; index++) {
    const elementSize = index === 2 || index === 3 ? 1 : 4;
    if (buffers[index]!.byteLength !== robotCount * elementSize) {
      throw new ProtocolError('Robot snapshot buffer length does not match robotIds');
    }
  }
  const podLength = buffers[5]!.byteLength / 4;
  for (let index = 5; index < BUFFER_COUNT; index++) {
    const elementSize = index >= 7 ? 1 : 4;
    if (buffers[index]!.byteLength !== podLength * elementSize) {
      throw new ProtocolError('Pod snapshot buffer lengths are inconsistent');
    }
  }
  return buffers as ArrayBuffer[];
}

/** Rebuilds a Snapshot from a worker snapshot event, validating its shape. */
export function decodeSnapshotEvent(event: SnapshotEvent): Snapshot {
  if (!isRecord(event) || event.type !== 'snapshot') {
    throw new ProtocolError('Expected a snapshot event');
  }
  const meta = validateMeta(event.meta);
  const buffers = validateBuffers(event.buffers, meta.robotIds);
  const [robotX, robotY, robotState, robotCarrying, robotBattery, podX, podY, podVisible, podState] =
    buffers as [ArrayBuffer, ArrayBuffer, ArrayBuffer, ArrayBuffer, ArrayBuffer, ArrayBuffer, ArrayBuffer, ArrayBuffer, ArrayBuffer];

  return {
    timeMs: meta.timeMs,
    robotIds: meta.robotIds,
    robots: {
      x: new Float32Array(robotX),
      y: new Float32Array(robotY),
      state: new Uint8Array(robotState),
      carrying: new Uint8Array(robotCarrying),
      battery: new Float32Array(robotBattery),
    },
    pods: {
      x: new Float32Array(podX),
      y: new Float32Array(podY),
      visible: new Uint8Array(podVisible),
      state: new Uint8Array(podState),
    },
    stations: meta.stations,
    // Structured clone may reorder/annotate fields; the event-level metrics
    // (always present from the worker) is authoritative when supplied.
    metrics: event.metrics ?? meta.metrics,
  };
}
