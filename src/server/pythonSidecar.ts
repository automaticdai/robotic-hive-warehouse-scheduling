import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { Interface as ReadlineInterface } from 'node:readline';

export interface SidecarInfo {
  url: string | null;
  online: boolean;
  strategies: string[];
}

interface SidecarCache {
  child: ChildProcess | null;
  info: SidecarInfo;
  startPromise: Promise<SidecarInfo> | null;
  cleanupRegistered: boolean;
}

const GLOBAL_KEY = '__hiveSimPythonSidecarCache' as const;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;
const HANDSHAKE_LINE_TYPE = 'hive-sim-sidecar';

function offlineInfo(): SidecarInfo {
  return { url: null, online: false, strategies: ['builtin:fcfs'] };
}

function copyInfo(info: SidecarInfo): SidecarInfo {
  return { url: info.url, online: info.online, strategies: [...info.strategies] };
}

function getCache(): SidecarCache {
  const holder = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: SidecarCache;
  };
  holder[GLOBAL_KEY] ??= {
    child: null,
    info: offlineInfo(),
    startPromise: null,
    cleanupRegistered: false,
  };
  return holder[GLOBAL_KEY];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Kills immediately, swallowing errors from an already-dead child. */
function killNow(child: ChildProcess): void {
  try {
    child.kill('SIGKILL');
  } catch {
    // The child is already gone.
  }
}

/** Terminates a child, escalating to SIGKILL after a short grace period. */
function terminate(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      killNow(child);
    }, 2_000);
    timer.unref();

    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

/**
 * Registers parent-lifetime cleanup exactly once. The exit handler is
 * synchronous by necessity; signal handlers forward a graceful SIGTERM to the
 * child and re-raise only when no other listener owns the signal.
 */
function registerCleanup(cache: SidecarCache): void {
  if (cache.cleanupRegistered) return;
  cache.cleanupRegistered = true;

  process.once('exit', () => {
    if (cache.child !== null) killNow(cache.child);
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const handleSignal = (): void => {
      const child = cache.child;
      if (child !== null && child.exitCode === null && child.signalCode === null) {
        try {
          child.kill('SIGTERM');
        } catch {
          // The child is already gone.
        }
      }
      // `process.once` removed this listener already, so a zero count means
      // nobody else handles the signal and the default action should run.
      if (process.listenerCount(signal) === 0) {
        process.kill(process.pid, signal);
      }
    };
    process.once(signal, handleSignal);
  }
}

interface SpawnedSidecar {
  child: ChildProcess;
  port: number;
}

/**
 * Spawns the sidecar and waits for its stdout handshake line. stdout continues
 * to be drained through the readline interface after the handshake; stderr is
 * resumed so the pipe never fills.
 */
function spawnSidecar(): Promise<SpawnedSidecar> {
  return new Promise((resolve, reject) => {
    const cwd = process.cwd();
    const child = spawn(process.env.HIVE_PYTHON ?? 'python3', ['-m', 'hive_sim.server', '--port', '0'], {
      cwd,
      env: { ...process.env, PYTHONPATH: path.join(cwd, 'python') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stderr?.resume();

    if (child.stdout === null) {
      killNow(child);
      reject(new Error('sidecar stdout is not available'));
      return;
    }

    const rl: ReadlineInterface = createInterface({ input: child.stdout });
    let settled = false;

    const settle = (error: Error | null, port?: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('error', onError);
      rl.removeListener('line', onLine);

      if (error !== null || port === undefined) {
        killNow(child);
        rl.close();
        reject(error ?? new Error('sidecar did not report a port'));
        return;
      }

      // Keep consuming stdout so a chatty child cannot block on a full pipe.
      rl.on('line', () => {});
      // Post-spawn errors (for example a failed signal delivery) must never
      // surface as an unhandled ChildProcess 'error' event.
      child.on('error', () => {});
      resolve({ child, port });
    };

    const onLine = (line: string): void => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (
        isRecord(message) &&
        message.type === HANDSHAKE_LINE_TYPE &&
        typeof message.port === 'number' &&
        Number.isInteger(message.port) &&
        message.port > 0 &&
        message.port <= 65_535
      ) {
        settle(null, message.port);
      }
    };

    const onError = (error: Error): void => {
      settle(error);
    };

    const timer = setTimeout(() => {
      settle(new Error(`sidecar handshake timed out after ${HANDSHAKE_TIMEOUT_MS} ms`));
    }, HANDSHAKE_TIMEOUT_MS);

    rl.on('line', onLine);
    child.once('error', onError);
    child.once('exit', (code, signal) => {
      settle(new Error(`sidecar exited during handshake (code ${String(code)}, signal ${String(signal)})`));
    });
  });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`GET ${url} returned HTTP ${response.status}`);
  }
  return response.json();
}

/** GET /strategies and return the bare module names. */
async function probeStrategies(url: string): Promise<string[]> {
  const payload = await fetchJson(`${url}/strategies`);
  if (!isRecord(payload) || !Array.isArray(payload.strategies)) {
    throw new Error('sidecar returned a malformed strategy list');
  }

  const names: string[] = [];
  for (const entry of payload.strategies) {
    if (isRecord(entry) && typeof entry.name === 'string' && entry.name !== '') {
      names.push(entry.name);
    }
  }
  return [...new Set(names)];
}

async function probeHealth(url: string): Promise<void> {
  const payload = await fetchJson(`${url}/health`);
  if (!isRecord(payload) || payload.status !== 'ok') {
    throw new Error('sidecar health check failed');
  }
}

async function spawnAndProbe(cache: SidecarCache): Promise<SidecarInfo> {
  registerCleanup(cache);

  try {
    const { child, port } = await spawnSidecar();
    cache.child = child;
    const url = `http://127.0.0.1:${port}`;

    await probeHealth(url);
    const strategies = await probeStrategies(url);
    cache.info = { url, online: true, strategies };
  } catch (error) {
    console.warn(`[hive-sim] Python sidecar unavailable: ${errorMessage(error)}`);
    if (cache.child !== null) {
      killNow(cache.child);
      cache.child = null;
    }
    cache.info = offlineInfo();
  }

  return copyInfo(cache.info);
}

async function reprobe(cache: SidecarCache): Promise<SidecarInfo> {
  const url = cache.info.url;
  if (url === null) return copyInfo(offlineInfo());

  try {
    const strategies = await probeStrategies(url);
    cache.info = { url, online: true, strategies };
  } catch (error) {
    console.warn(`[hive-sim] Python sidecar probe failed: ${errorMessage(error)}`);
    const child = cache.child;
    if (child !== null && (child.exitCode !== null || child.signalCode !== null)) {
      cache.child = null;
    }
    cache.info = offlineInfo();
  }

  return copyInfo(cache.info);
}

/**
 * Starts the sidecar on first use and returns its address and strategies.
 * Concurrent callers share one in-flight promise; later callers re-probe the
 * existing process instead of spawning another. Spawn failures degrade to the
 * offline fallback rather than rejecting.
 */
export function startPythonSidecar(): Promise<SidecarInfo> {
  const cache = getCache();
  if (cache.startPromise !== null) return cache.startPromise;

  if (cache.child !== null && !cache.info.online) {
    // A previous child is still around but unhealthy; replace it rather than
    // leaking it when the new process starts.
    killNow(cache.child);
    cache.child = null;
  }

  const task =
    cache.child !== null && cache.info.online
      ? reprobe(cache)
      : spawnAndProbe(cache);

  cache.startPromise = task.then(
    (info) => {
      cache.startPromise = null;
      return info;
    },
    (error: unknown) => {
      cache.startPromise = null;
      throw error;
    },
  );
  return cache.startPromise;
}

/** Returns the cached snapshot; offline before the sidecar has started. */
export function getSidecarInfo(): SidecarInfo {
  return copyInfo(getCache().info);
}

/**
 * Kills the sidecar (if any), clears the cache, and resets to the offline
 * fallback. Safe to call when nothing was started.
 */
export async function stopPythonSidecar(): Promise<void> {
  const cache = getCache();

  const pending = cache.startPromise;
  if (pending !== null) {
    try {
      await pending;
    } catch {
      // A failed start has nothing left to stop.
    }
  }

  const child = cache.child;
  cache.child = null;
  cache.info = offlineInfo();
  if (cache.startPromise === pending) cache.startPromise = null;

  if (child !== null) await terminate(child);
}
