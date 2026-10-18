import type { AllocationObservation, Allocator, Assignment } from '@/sim/allocation';
import { AllocatorError, AllocatorTimeoutError } from './allocator';

export { AllocatorError, AllocatorTimeoutError };

export interface PythonAllocatorOptions {
  /** Base URL of the running sidecar, e.g. `http://127.0.0.1:12345`. */
  baseUrl: string;
  /** Bare Python strategy module name, e.g. `auction`. */
  strategy: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
}

const MALFORMED = Symbol('malformed-json');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.name === 'TimeoutError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseAssignment(value: unknown): Assignment {
  if (
    !isRecord(value) ||
    typeof value.jobId !== 'string' ||
    typeof value.robotId !== 'string' ||
    typeof value.stationId !== 'string'
  ) {
    throw new AllocatorError('Python sidecar returned a malformed assignment');
  }
  return { jobId: value.jobId, robotId: value.robotId, stationId: value.stationId };
}

/**
 * HTTP client for one strategy session in the Python sidecar.
 *
 * A session is created lazily on the first call that needs one, so constructing
 * the allocator never touches the network. Every request uses
 * `AbortSignal.timeout(timeoutMs)`; aborts become `AllocatorTimeoutError`, while
 * network failures, non-2xx responses, `{error}` payloads, and malformed bodies
 * become `AllocatorError`.
 */
export class PythonAllocator implements Allocator {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private strategy: string;
  private sessionId: string | null = null;

  constructor({ baseUrl, strategy, timeoutMs }: PythonAllocatorOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.strategy = strategy;
    this.timeoutMs = timeoutMs;
  }

  async allocate(observation: AllocationObservation): Promise<Assignment[]> {
    const sessionId = await this.ensureSession();
    const payload = await this.request(`/sessions/${sessionId}/allocate`, {
      method: 'POST',
      body: JSON.stringify(observation),
    });

    if (!isRecord(payload) || !Array.isArray(payload.assignments)) {
      throw new AllocatorError('Python sidecar returned a malformed allocate response');
    }
    return payload.assignments.map(parseAssignment);
  }

  async select(strategy: string): Promise<void> {
    const sessionId = await this.ensureSession();
    await this.request(`/sessions/${sessionId}/select`, {
      method: 'POST',
      body: JSON.stringify({ strategy }),
    });
    this.strategy = strategy;
  }

  async dispose(): Promise<void> {
    const sessionId = this.sessionId;
    this.sessionId = null;
    if (sessionId === null) return;

    try {
      await this.request(`/sessions/${sessionId}`, { method: 'DELETE' });
    } catch {
      // Best effort: the sidecar may already be gone or shutting down.
    }
  }

  private async ensureSession(): Promise<string> {
    if (this.sessionId !== null) return this.sessionId;

    const payload = await this.request('/sessions', {
      method: 'POST',
      body: JSON.stringify({ strategy: this.strategy, config: {} }),
    });

    if (!isRecord(payload) || typeof payload.sessionId !== 'string' || payload.sessionId === '') {
      throw new AllocatorError('Python sidecar returned a malformed session response');
    }

    this.sessionId = payload.sessionId;
    if (typeof payload.strategy === 'string' && payload.strategy !== '') {
      this.strategy = payload.strategy;
    }
    return this.sessionId;
  }

  private async request(pathname: string, init: RequestInit): Promise<unknown> {
    let text: string;
    let status: number;
    let ok: boolean;

    try {
      const response = await fetch(`${this.baseUrl}${pathname}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...init.headers },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      status = response.status;
      ok = response.ok;
      text = await response.text();
    } catch (error) {
      if (error instanceof AllocatorError) throw error;
      if (isAbortError(error)) {
        throw new AllocatorTimeoutError(
          `Python sidecar request ${pathname} timed out after ${this.timeoutMs} ms`,
          { cause: error },
        );
      }
      throw new AllocatorError(
        `Python sidecar request ${pathname} failed: ${errorMessage(error)}`,
        { cause: error },
      );
    }

    let body: unknown = null;
    if (text.trim() !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        body = MALFORMED;
      }
    }

    if (!ok) {
      const detail =
        isRecord(body) && typeof body.error === 'string' ? body.error : `HTTP ${status}`;
      throw new AllocatorError(`Python sidecar request ${pathname} failed: ${detail}`);
    }

    if (body === MALFORMED) {
      throw new AllocatorError(`Python sidecar returned malformed JSON for ${pathname}`);
    }
    return body;
  }
}
