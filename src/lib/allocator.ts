import type { Allocator } from '@/sim/allocation';
import type { AllocationObservation, Assignment } from '@/sim/allocation';
import { FcfsAllocator } from '@/sim/fcfs';
import { PythonAllocator } from './pythonAllocator';

export type { Allocator, AllocationObservation, Assignment };

/** Raised when an allocator cannot be created or an HTTP call fails. */
export class AllocatorError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AllocatorError';
  }
}

/** Raised when a sidecar request exceeds its configured timeout. */
export class AllocatorTimeoutError extends AllocatorError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AllocatorTimeoutError';
  }
}

export interface CreateAllocatorOptions {
  /** Base URL of a running sidecar, or null when it is offline. */
  pythonUrl: string | null;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
}

/**
 * Only plain Python identifiers are valid module names. This mirrors the
 * sidecar runner, which refuses names that are empty, start with `_`, or
 * contain path separators, and additionally rejects dots so a strategy id can
 * never escape `python/strategies`.
 */
const PYTHON_MODULE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * Extracts and validates the bare module name from a `python:<module>`
 * strategy id. Throws `AllocatorError` for non-Python ids and for names that
 * could resolve outside the strategies directory.
 */
export function pythonModuleName(strategy: string): string {
  if (!strategy.startsWith('python:')) {
    throw new AllocatorError(`Not a Python strategy: "${strategy}"`);
  }

  const moduleName = strategy.slice('python:'.length);
  if (!PYTHON_MODULE_PATTERN.test(moduleName)) {
    throw new AllocatorError(`Invalid Python strategy name: "${moduleName}"`);
  }
  return moduleName;
}

/**
 * Builds an allocator for a strategy identifier.
 *
 * `builtin:fcfs` resolves to the in-process reference allocator; `python:<module>`
 * resolves to a sidecar client when a sidecar URL is available. Missing sidecar
 * URLs, invalid module names, and unknown namespaces fail synchronously so a
 * misconfiguration is reported before the simulation starts.
 */
export function createAllocator(
  strategy: string,
  options: CreateAllocatorOptions,
): Allocator {
  if (strategy === 'builtin:fcfs') {
    return new FcfsAllocator();
  }

  if (strategy.startsWith('python:')) {
    const moduleName = pythonModuleName(strategy);
    if (options.pythonUrl === null) {
      throw new AllocatorError(
        `Cannot create allocator for "${strategy}": the Python sidecar is offline`,
      );
    }
    return new PythonAllocator({
      baseUrl: options.pythonUrl,
      strategy: moduleName,
      timeoutMs: options.timeoutMs,
    });
  }

  throw new AllocatorError(
    `Unknown strategy "${strategy}" (supported: builtin:fcfs, python:<module>)`,
  );
}
