import { z } from 'zod';
import { storageCells, type Rect } from './layout';

export interface Cell {
  x: number;
  y: number;
}

export interface GridConfig {
  width: number;
  height: number;
}

export interface StationConfig {
  id: string;
  docks: Cell[];
  queueCapacity: number;
  serviceTimeMs: number;
}

export interface PodsConfig {
  count: number;
  replenishDelayMs: number;
}

export interface OrdersConfig {
  arrivalRatePerHour: number;
  linesPerOrder: { min: number; max: number };
  packingTimeMs: number;
}

export interface AllocationConfig {
  intervalMs: number;
  strategy: string;
  timeoutMs: number;
  onFailure: 'fallback-fcfs' | 'wait';
}

export interface LayoutConfig {
  /**
   * Rectangle pods are stored in. `null` derives it from the grid, keeping a
   * `portClearance`-wide pod-free aisle along every edge that carries a dock.
   */
  storage: Rect | null;
  /** Minimum Manhattan distance between any pod home slot and any dock. */
  portClearance: number;
}

export interface MovementConfig {
  tickMs: number;
}

export interface SimConfig {
  grid: GridConfig;
  robots: number;
  pods: PodsConfig;
  stations: StationConfig[];
  orders: OrdersConfig;
  allocation: AllocationConfig;
  layout: LayoutConfig;
  movement: MovementConfig;
  seed: number;
}

export class ConfigError extends Error {
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(issues: readonly z.core.$ZodIssue[]) {
    const details = issues
      .map((issue) => {
        const path = issue.path.map((part) => String(part)).join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join('; ');
    super(details || 'Invalid simulation configuration');
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const positiveInt = z.number().int().positive();
const nonNegative = z.number().min(0);
const cellTuple = z.tuple([z.number().int(), z.number().int()]);

const defaultStations = [
  { id: 'S-1', docks: [[0, 25], [0, 26]], queueCapacity: 8, serviceTimeMs: 1000 },
  { id: 'S-2', docks: [[99, 50], [99, 51]], queueCapacity: 8, serviceTimeMs: 1000 },
  { id: 'S-3', docks: [[0, 75], [0, 76]], queueCapacity: 8, serviceTimeMs: 1000 },
] as const;

const stationSchema = z.object({
  id: z.string().min(1),
  docks: z.array(cellTuple).min(1),
  queueCapacity: positiveInt,
  serviceTimeMs: positiveInt,
});

const rawConfigSchema = z.object({
  grid: z
    .object({
      width: positiveInt.default(100),
      height: positiveInt.default(100),
    })
    .default({ width: 100, height: 100 }),
  robots: positiveInt.default(2000),
  pods: z
    .object({
      count: positiveInt.default(6000),
      replenishDelayMs: positiveInt.default(5000),
    })
    .default({ count: 6000, replenishDelayMs: 5000 }),
  stations: z.array(stationSchema).min(1).default(defaultStations.map((station) => ({
    ...station,
    docks: station.docks.map(([x, y]) => [x, y] as [number, number]),
  }))),
  orders: z
    .object({
      arrivalRatePerHour: nonNegative.default(1600),
      linesPerOrder: z
        .object({
          min: positiveInt.default(1),
          max: positiveInt.default(6),
        })
        .default({ min: 1, max: 6 }),
      packingTimeMs: positiveInt.default(30000),
    })
    .default({
      arrivalRatePerHour: 1600,
      linesPerOrder: { min: 1, max: 6 },
      packingTimeMs: 30000,
    }),
  allocation: z
    .object({
      intervalMs: positiveInt.default(1000),
      strategy: z.string().min(1).default('builtin:fcfs'),
      timeoutMs: positiveInt.default(2000),
      onFailure: z.enum(['fallback-fcfs', 'wait']).default('fallback-fcfs'),
    })
    .default({
      intervalMs: 1000,
      strategy: 'builtin:fcfs',
      timeoutMs: 2000,
      onFailure: 'fallback-fcfs',
    }),
  layout: z
    .object({
      storage: z
        .object({
          x: z.number().int().min(0),
          y: z.number().int().min(0),
          width: positiveInt,
          height: positiveInt,
        })
        .nullable()
        .default(null),
      portClearance: z.number().int().min(0).default(3),
    })
    .default({ storage: null, portClearance: 3 }),
  movement: z
    .object({ tickMs: positiveInt.default(100) })
    .default({ tickMs: 100 }),
  seed: z.number().int().default(42),
});

type RawSimConfig = z.infer<typeof rawConfigSchema>;

const configSchema = rawConfigSchema
  .superRefine((config, ctx) => {
    const { width, height } = config.grid;
    const robotsLimit = width * height;

    if (config.robots > robotsLimit) {
      ctx.addIssue({
        code: 'custom',
        path: ['robots'],
        message: `robots (${config.robots}) exceeds grid cell count (${robotsLimit})`,
      });
    }

    if (config.pods.count > robotsLimit) {
      ctx.addIssue({
        code: 'custom',
        path: ['pods', 'count'],
        message: `pods.count (${config.pods.count}) exceeds grid cell count (${robotsLimit})`,
      });
    }

    if (config.robots + config.pods.count > robotsLimit) {
      ctx.addIssue({
        code: 'custom',
        path: ['pods', 'count'],
        message: `robots (${config.robots}) + pods.count (${config.pods.count}) exceeds grid cell count (${robotsLimit})`,
      });
    }

    const storage = config.layout.storage;
    if (storage !== null && (storage.x + storage.width > width || storage.y + storage.height > height)) {
      ctx.addIssue({
        code: 'custom',
        path: ['layout', 'storage'],
        message: `storage rectangle extends outside the ${width}x${height} grid`,
      });
    }

    const slots = storageCells({
      grid: config.grid,
      stations: config.stations.map((station) => ({
        docks: station.docks.map(([x, y]) => ({ x, y })),
      })),
      layout: config.layout,
    }).length;
    if (config.pods.count > slots) {
      ctx.addIssue({
        code: 'custom',
        path: ['pods', 'count'],
        message: `pods.count (${config.pods.count}) exceeds the ${slots} storage slots clear of station ports`,
      });
    }

    if (config.orders.linesPerOrder.min > config.orders.linesPerOrder.max) {
      ctx.addIssue({
        code: 'custom',
        path: ['orders', 'linesPerOrder'],
        message: 'linesPerOrder.min must be less than or equal to linesPerOrder.max',
      });
    }

    const stationIds = new Set<string>();
    for (let index = 0; index < config.stations.length; index++) {
      const station = config.stations[index];

      if (stationIds.has(station.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['stations', index, 'id'],
          message: `duplicate station id "${station.id}"`,
        });
      }
      stationIds.add(station.id);

      for (let dockIndex = 0; dockIndex < station.docks.length; dockIndex++) {
        const [x, y] = station.docks[dockIndex];
        if (x < 0 || x >= width || y < 0 || y >= height) {
          ctx.addIssue({
            code: 'custom',
            path: ['stations', index, 'docks', dockIndex],
            message: `dock (${x}, ${y}) is outside the ${width}x${height} grid`,
          });
        }
      }
    }

    const dockCells = new Set<string>();
    for (let index = 0; index < config.stations.length; index++) {
      const station = config.stations[index];
      for (let dockIndex = 0; dockIndex < station.docks.length; dockIndex++) {
        const [x, y] = station.docks[dockIndex];
        const key = `${x},${y}`;
        if (dockCells.has(key)) {
          ctx.addIssue({
            code: 'custom',
            path: ['stations', index, 'docks', dockIndex],
            message: `duplicate dock cell (${x}, ${y})`,
          });
        }
        dockCells.add(key);
      }
    }
  })
  .transform((config: RawSimConfig): SimConfig => ({
    ...config,
    stations: config.stations.map((station) => ({
      ...station,
      docks: station.docks.map(([x, y]) => ({ x, y })),
    })),
  }));

export function parseConfig(input: unknown): SimConfig {
  const result = configSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError(result.error.issues);
  }
  return result.data;
}

export const defaultConfig: SimConfig = parseConfig({});
