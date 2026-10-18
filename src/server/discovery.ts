import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultConfig, parseConfig } from '@/sim/config';
import type { SimConfig } from '@/sim/config';
import { getSidecarInfo } from './pythonSidecar';

export interface SimConfigResponse {
  strategies: string[];
  defaultConfig: SimConfig;
  sidecar: {
    url: string | null;
    online: boolean;
  };
}

export interface ConfigEntry {
  name: string;
  config: SimConfig;
}

/**
 * Strategy identifiers for the UI: the built-in FCFS allocator first, followed
 * by every bare sidecar module prefixed with `python:`. Duplicates are removed
 * while preserving that order.
 */
export async function getSimConfigResponse(): Promise<SimConfigResponse> {
  const sidecar = getSidecarInfo();

  const strategies = ['builtin:fcfs'];
  for (const name of sidecar.strategies) {
    if (name === 'builtin:fcfs') continue;
    const qualified = name.startsWith('python:') ? name : `python:${name}`;
    if (!strategies.includes(qualified)) strategies.push(qualified);
  }

  return {
    strategies,
    defaultConfig,
    sidecar: { url: sidecar.url, online: sidecar.online },
  };
}

/**
 * Reads every `configs/*.json` file, sorted by name. Files that fail to parse
 * are logged and skipped so one broken config cannot break discovery.
 */
export async function getConfigsResponse(): Promise<ConfigEntry[]> {
  const directory = path.join(process.cwd(), 'configs');

  let files: string[];
  try {
    files = await readdir(directory);
  } catch (error) {
    console.warn(
      `[hive-sim] Unable to read configs directory ${directory}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return [];
  }

  const entries: ConfigEntry[] = [];
  for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
    const name = file.slice(0, -'.json'.length);
    try {
      const raw: unknown = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
      entries.push({ name, config: parseConfig(raw) });
    } catch (error) {
      console.warn(
        `[hive-sim] Skipping invalid config ${file}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return entries;
}
