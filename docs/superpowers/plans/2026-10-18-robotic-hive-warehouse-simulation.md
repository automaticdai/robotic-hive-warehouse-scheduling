# Robotic Hive Warehouse Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser and headless Ocado-style hive warehouse simulator with a stateful Python task-allocation interface.

**Architecture:** One pure-TypeScript simulation core shared by a Node headless runner and a browser Web Worker. React Three Fiber renders instanced snapshots; the HUD drives run controls through a worker client. A stdlib-only Python HTTP sidecar loads stateful strategy classes and receives whole allocation batches.

**Tech Stack:** Next.js (App Router), React, TypeScript, React Three Fiber, Drei, Three.js, Zustand, Zod, Vitest, Python 3.10+ standard library, pytest.

**Spec:** `docs/superpowers/specs/2026-10-18-robotic-hive-warehouse-simulation-design.md`

## Global Constraints

- Node.js 20+, Python 3.10+, npm.
- Next.js App Router with `src/` directory and `@/*` → `src/*` alias.
- `src/sim/**` must not import DOM, React, Three.js, or Next.js.
- Python sidecar uses the standard library only; no pip packages at runtime.
- Coordinates are 0-based `(x, y)`; stations have one or more in-grid dock cells.
- Determinism: seeded PRNG only; no `Math.random`, `Date.now`, or wall clock in `src/sim/**`.
- Defaults: grid 100×100, 2,000 robots, 6,000 pods, tick 100 ms, allocation interval 1,000 ms, allocation timeout 2,000 ms wall clock, station queue capacity 8, service 20,000 ms, packing 30,000 ms, order arrival 1,600/hour, 1–6 lines/order, seed 42.
- Built-in FCFS strategy id is `builtin:fcfs`; Python strategies are `python:<module-name>`.
- FCFS must run with Python stopped.
- Simulation time pauses during allocation calls; ticks are never skipped.
- Rendering target: 2,000 robots at ≥30 fps while simulation advances at 1×.
- Layout A: full-bleed hive, floating metrics panel, floating inspector, bottom-centre transport dock.

## Review Focus

- **Invalid allocator output** — unknown IDs, non-idle robots, duplicate jobs/robots, wrong station: reject per assignment, count it, never crash or double-assign. Tested in Task 5.
- **Full station queue on arrival** — robot waits at the dock, is not assignable, then deposits when a slot frees. Tested in Task 5.
- **Allocator timeout or late response** — stale assignments must never apply; fallback or wait per config. Tested in Tasks 5 and 10.
- **Python missing, crashing, or returning errors** — FCFS still runs, status is visible, no unhandled rejection. Tested in Tasks 9 and 10.
- **Determinism** — same config, seed, and deterministic strategy produce identical summaries across runs. Tested in Tasks 3, 4, and 7.

---

## File Structure

```
src/app/                      Next.js pages and API routes
src/components/hive/          R3F canvas and instanced renderers
src/components/hud/           Layout A panels and dock
src/sim/                      Pure simulation core
src/headless/                 Headless run orchestration
src/lib/                      Allocator clients, worker client, HUD store
src/server/                   Python sidecar lifecycle
src/worker/                   Worker entry and message protocol
scripts/                      CLI entry points
python/hive_sim/              Stdlib HTTP sidecar
python/strategies/            User-editable strategies
python/tests/                 pytest suite
configs/                      Scenario JSON
tests/                        Vitest suite
docs/                         Design, plan, README later
```

---

### Task 1: Project Scaffold and App Shell

**Files:**
- Create: `package.json`, `vitest.config.ts`, `tests/setup.ts`, `tests/scaffold.test.tsx`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `.gitignore`
- Modify: `package.json` scripts, `.gitignore`

**Interfaces:**
- Produces: working `npm run dev`, `npm run build`, `npm test`; path alias `@/*`; Vitest with jsdom available per file.

- [ ] **Step 1: Scaffold the Next.js app and install dependencies**

Run from the repo root:

```bash
npx create-next-app@latest . --yes --ts --eslint --app --src-dir --no-tailwind --use-npm --import-alias "@/*"
npm install three @react-three/fiber @react-three/drei zustand zod
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @vitejs/plugin-react @types/three tsx
```

If `create-next-app` refuses the non-empty directory, scaffold into a temp directory and move `src/`, `public/`, `package.json`, `tsconfig.json`, `eslint.config.*`, `next.config.*`, and `next-env.d.ts` into the repo, preserving `docs/` and `.superpowers/`.

- [ ] **Step 2: Configure Vitest and scripts**

`vitest.config.ts`:

```ts
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: { environment: 'node', setupFiles: ['tests/setup.ts'] },
});
```

`tests/setup.ts`: `import '@testing-library/jest-dom/vitest';`

Add scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, `"sim": "tsx scripts/run-headless.ts"`, `"benchmark": "tsx scripts/benchmark.ts"`, `"lint": "eslint ."`.

- [ ] **Step 3: Write the failing app-shell test**

`tests/scaffold.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import Page from '@/app/page';

test('renders the simulator heading', () => {
  render(<Page />);
  expect(
    screen.getByRole('heading', { name: /hive warehouse simulator/i }),
  ).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- tests/scaffold.test.tsx`
Expected: FAIL — the scaffold page has no such heading.

- [ ] **Step 5: Replace the page with the simulator shell**

`src/app/page.tsx`:

```tsx
export default function Page() {
  return (
    <main>
      <h1>Hive Warehouse Simulator</h1>
    </main>
  );
}
```

Set the metadata title in `src/app/layout.tsx` to `Hive Warehouse Simulator` and replace default global styles with a dark base (`background: #0b1014; color: #cfe3dd;`).

- [ ] **Step 6: Verify tests and build pass**

Run: `npm test -- tests/scaffold.test.tsx && npm run build`
Expected: 1 test passes; build exits 0.

- [ ] **Step 7: Ignore local brainstorming artifacts and commit**

Ensure `.gitignore` contains `.superpowers/`, `.next/`, `node_modules/`, `results/`, `coverage/`.

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Three.js and test tooling"
```

---

### Task 2: Config Schema and Seeded RNG

**Files:**
- Create: `src/sim/config.ts`, `src/sim/rng.ts`, `tests/config.test.ts`, `tests/rng.test.ts`

**Interfaces:**
- Produces:
  - `parseConfig(input: unknown): SimConfig` — fills defaults, throws `ConfigError`.
  - `defaultConfig: SimConfig`.
  - Types `SimConfig`, `GridConfig`, `StationConfig`, `Cell`, `ConfigError`.
  - `createRng(seed: number): Rng` with `next(): number`, `int(maxExclusive: number): number`, `pick<T>(items: readonly T[]): T`.

- [ ] **Step 1: Write the failing config tests**

`tests/config.test.ts`:

```ts
import { ConfigError, defaultConfig, parseConfig } from '@/sim/config';

test('fills defaults for an empty object', () => {
  expect(parseConfig({})).toEqual(defaultConfig);
});

test('rejects a dock outside the grid', () => {
  expect(() =>
    parseConfig({
      grid: { width: 10, height: 10 },
      stations: [{ id: 'S-1', docks: [[10, 1]], queueCapacity: 4, serviceTimeMs: 1000 }],
    }),
  ).toThrow(ConfigError);
});

test('rejects duplicate dock cells across stations', () => {
  expect(() =>
    parseConfig({
      stations: [
        { id: 'S-1', docks: [[0, 1]], queueCapacity: 4, serviceTimeMs: 1000 },
        { id: 'S-2', docks: [[0, 1]], queueCapacity: 4, serviceTimeMs: 1000 },
      ],
    }),
  ).toThrow(ConfigError);
});

test('rejects more robots than grid cells', () => {
  expect(() =>
    parseConfig({
      grid: { width: 2, height: 2 },
      robots: 5,
      stations: [{ id: 'S-1', docks: [[0, 0]], queueCapacity: 1, serviceTimeMs: 1000 }],
    }),
  ).toThrow(ConfigError);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the config schema**

`src/sim/config.ts` must define the interfaces below and a Zod schema with defaults; `parseConfig` runs `safeParse` and throws `ConfigError(issues)` on failure.

```ts
export interface Cell { x: number; y: number }
export interface GridConfig { width: number; height: number }
export interface StationConfig {
  id: string;
  docks: Cell[];
  queueCapacity: number;
  serviceTimeMs: number;
}
export interface PodsConfig { count: number; replenishDelayMs: number }
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
export interface MovementConfig { tickMs: number }
export interface SimConfig {
  grid: GridConfig;
  robots: number;
  pods: PodsConfig;
  stations: StationConfig[];
  orders: OrdersConfig;
  allocation: AllocationConfig;
  movement: MovementConfig;
  seed: number;
}
```

`defaultConfig` uses the Global Constraints values, three stations with docks `[[0,25],[0,26]]`, `[[99,50],[99,51]]`, `[[0,75],[0,76]]`, and strategy `builtin:fcfs`.

Validation: all counts and durations are positive integers; `arrivalRatePerHour >= 0`; `1 <= linesPerOrder.min <= linesPerOrder.max`; station ids unique; dock cells in bounds and unique across all stations; `robots <= width * height`; `pods.count <= width * height`.

- [ ] **Step 4: Run config tests to verify they pass**

Run: `npm test -- tests/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing RNG tests**

`tests/rng.test.ts`:

```ts
import { createRng } from '@/sim/rng';

test('same seed produces the same sequence', () => {
  const a = createRng(42);
  const b = createRng(42);
  expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
});

test('different seeds differ and values stay in range', () => {
  expect(createRng(7).next()).not.toBe(createRng(8).next());
  const rng = createRng(1);
  for (let i = 0; i < 100; i++) {
    const value = rng.next();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
    expect(rng.int(6)).toBeGreaterThanOrEqual(0);
    expect(rng.int(6)).toBeLessThan(6);
  }
});
```

- [ ] **Step 6: Run the RNG tests to verify they fail**

Run: `npm test -- tests/rng.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement `createRng` with mulberry32**

```ts
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
}
export function createRng(seed: number): Rng;
```

`pick` throws on an empty array.

- [ ] **Step 8: Verify and commit**

Run: `npm test -- tests/config.test.ts tests/rng.test.ts`
Expected: PASS.

```bash
git add src/sim/config.ts src/sim/rng.ts tests/config.test.ts tests/rng.test.ts
git commit -m "feat: add scenario config schema and seeded RNG"
```

---

### Task 3: World Model and Order Generation

**Files:**
- Create: `src/sim/types.ts`, `src/sim/world.ts`, `src/sim/orders.ts`, `tests/world.test.ts`, `tests/orders.test.ts`

**Interfaces:**
- Consumes: `SimConfig`, `Cell`, `createRng`, `Rng`.
- Produces:
  - `createWorld(config: SimConfig): World` — robots and pods placed deterministically from `config.seed`.
  - `World` with mutable `simTimeMs`, `robots`, `pods`, `stations`, `jobs: Map<string, Job>`, `orders: Map<string, Order>`, `rng`.
  - `OrderGenerator` with `generateDueOrders(): Order[]`.
  - Entity types below.

```ts
export type RobotStatus =
  | 'idle' | 'moving_empty' | 'moving_loaded' | 'waiting' | 'at_station';

export interface Robot {
  id: string; cell: Cell; status: RobotStatus; battery: number;
  jobId: string | null; carrying: boolean;
  path: Cell[]; assignedAtMs: number; blockedTicks: number;
}

export interface Pod {
  id: string; cell: Cell; available: boolean;
  reservedByJobId: string | null; replenishAtMs: number | null;
}

export interface QueuedPod { podId: string; orderId: string; jobId: string }
export interface Station {
  id: string; docks: Cell[]; queueCapacity: number; serviceTimeMs: number;
  queue: QueuedPod[]; serviceRemainingMs: number;
}

export type JobStatus = 'pending' | 'ready' | 'assigned' | 'complete';
export interface Job {
  id: string; orderId: string; podId: string; pickup: Cell;
  candidateStations: string[]; dependsOn: string[];
  priority: number; createdAtMs: number; status: JobStatus;
  stationId: string | null; robotId: string | null; completedAtMs: number | null;
}

export interface Order {
  id: string; createdAtMs: number; jobIds: string[];
  stationId: string | null; podsTotal: number; podsServiced: number;
  packingRemainingMs: number | null; completedAtMs: number | null;
}

export interface World {
  config: SimConfig; simTimeMs: number; tick: number;
  robots: Robot[]; pods: Pod[]; stations: Station[];
  jobs: Map<string, Job>; orders: Map<string, Order>; rng: Rng;
}
```

IDs are zero-padded: `R-0001`, `P-00001`, `J-0000001`, `O-000001`.

- [ ] **Step 1: Write the failing world tests**

`tests/world.test.ts`:

```ts
import { parseConfig } from '@/sim/config';
import { cellKey } from '@/sim/world';
import { createWorld } from '@/sim/world';

const config = parseConfig({
  grid: { width: 10, height: 10 },
  robots: 5,
  pods: { count: 7 },
  stations: [{ id: 'S-1', docks: [[0, 5]], queueCapacity: 4, serviceTimeMs: 1000 }],
  seed: 42,
});

test('world placement is deterministic for a seed', () => {
  const a = createWorld(config);
  const b = createWorld(config);
  expect(a.robots.map((r) => r.cell)).toEqual(b.robots.map((r) => r.cell));
  expect(a.pods.map((p) => p.cell)).toEqual(b.pods.map((p) => p.cell));
});

test('robots and pods each occupy distinct cells', () => {
  const world = createWorld(config);
  expect(new Set(world.robots.map((r) => cellKey(r.cell))).size).toBe(5);
  expect(new Set(world.pods.map((p) => cellKey(p.cell))).size).toBe(7);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/world.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `createWorld` and `cellKey`**

Shuffle cell indices with the seeded RNG, take the first N for robots and the next M for pods. Initialize all robots `idle`, battery 1, no job. Initialize stations with an empty queue and `serviceRemainingMs: 0`.

- [ ] **Step 4: Write the failing order-generation tests**

`tests/orders.test.ts`:

```ts
import { parseConfig } from '@/sim/config';
import { OrderGenerator } from '@/sim/orders';
import { createWorld } from '@/sim/world';

const config = parseConfig({
  grid: { width: 20, height: 20 },
  robots: 4,
  pods: { count: 50 },
  stations: [
    { id: 'S-1', docks: [[0, 5]], queueCapacity: 4, serviceTimeMs: 1000 },
    { id: 'S-2', docks: [[19, 5]], queueCapacity: 4, serviceTimeMs: 1000 },
  ],
  orders: { arrivalRatePerHour: 3600, linesPerOrder: { min: 2, max: 2 } },
  seed: 42,
});

test('each order expands into one ready trip per line', () => {
  const world = createWorld(config);
  const generator = new OrderGenerator(world, config.orders, world.rng);
  world.simTimeMs = 60_000;
  const orders = generator.generateDueOrders();
  expect(orders.length).toBeGreaterThan(0);
  for (const order of orders) {
    expect(order.jobIds).toHaveLength(2);
    for (const jobId of order.jobIds) {
      const job = world.jobs.get(jobId)!;
      expect(job.orderId).toBe(order.id);
      expect(job.status).toBe('ready');
      expect(job.dependsOn).toEqual([]);
      expect(job.candidateStations).toEqual(['S-1', 'S-2']);
    }
  }
});

test('a pod is never reserved by two live jobs', () => {
  const world = createWorld(config);
  const generator = new OrderGenerator(world, config.orders, world.rng);
  world.simTimeMs = 60_000;
  generator.generateDueOrders();
  const reserved = [...world.jobs.values()].map((job) => job.podId);
  expect(new Set(reserved).size).toBe(reserved.length);
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npm test -- tests/orders.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 6: Implement `OrderGenerator`**

Constructor schedules the first arrival at `simTimeMs + exponentialInterarrival()`. `generateDueOrders` loops while the next arrival is `<= world.simTimeMs`, creating orders with `linesPerOrder` jobs, selecting available unreserved pods (cap the line count at availability; skip the order if none), reserving each pod, and advancing to the next sampled arrival. Exponential sample: `-Math.log(1 - rng.next()) * (3_600_000 / arrivalRatePerHour)`; when the rate is 0, return no orders.

- [ ] **Step 7: Verify and commit**

Run: `npm test -- tests/world.test.ts tests/orders.test.ts`
Expected: PASS.

```bash
git add src/sim/types.ts src/sim/world.ts src/sim/orders.ts tests/world.test.ts tests/orders.test.ts
git commit -m "feat: add deterministic world and order generator"
```

---

### Task 4: Grid Movement and Traffic

**Files:**
- Create: `src/sim/movement.ts`, `tests/movement.test.ts`

**Interfaces:**
- Consumes: `World`, `Robot`, `Cell`, `cellKey` from Task 3.
- Produces:
  - `manhattan(a: Cell, b: Cell): number`
  - `findPath(grid: GridConfig, start: Cell, goal: Cell, extraCost?: (cell: Cell) => number): Cell[]` — returns the sequence of cells after `start`, ending at `goal`; empty when already there.
  - `detectWaitCycles(blockedBy: Map<string, string>): string[][]`
  - `updateMovement(world: World): MovementStats` where `MovementStats = { moves: number; blocks: number; replans: number; deadlockEvents: number }`.

Priority order for conflicts: carrying (`moving_loaded`) first, then older `assignedAtMs`, then lexicographic robot id. Sequential priority application is the chosen implementation; a robot cannot enter an occupied cell this tick. Replan after 10 consecutive blocked ticks. Deadlock recovery: on a detected wait cycle, the lowest-priority robot clears its path and sidesteps to an adjacent free cell if one exists; count one deadlock event.

- [ ] **Step 1: Write the failing path and cycle tests**

`tests/movement.test.ts`:

```ts
import { detectWaitCycles, findPath, manhattan } from '@/sim/movement';

test('path is 4-connected and ends at the goal', () => {
  const path = findPath({ width: 10, height: 10 }, { x: 0, y: 0 }, { x: 3, y: 2 });
  expect(path.at(-1)).toEqual({ x: 3, y: 2 });
  let previous = { x: 0, y: 0 };
  for (const cell of path) {
    expect(manhattan(previous, cell)).toBe(1);
    previous = cell;
  }
});

test('high extra cost is avoided when a detour exists', () => {
  const path = findPath(
    { width: 3, height: 3 },
    { x: 0, y: 1 },
    { x: 2, y: 1 },
    (cell) => (cell.x === 1 && cell.y === 1 ? 100 : 0),
  );
  expect(path).not.toContainEqual({ x: 1, y: 1 });
});

test('detects a two-robot wait cycle', () => {
  const cycles = detectWaitCycles(
    new Map([
      ['R-1', 'R-2'],
      ['R-2', 'R-1'],
    ]),
  );
  expect(cycles).toHaveLength(1);
  expect(cycles[0].sort()).toEqual(['R-1', 'R-2']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/movement.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement A*, Manhattan, and cycle detection**

A* uses 4-neighbour movement, cost `1 + extraCost(cell)`, Manhattan heuristic, and a stable tie-break (cell index). `detectWaitCycles` returns each cycle once, ordered deterministically.

- [ ] **Step 4: Write the failing movement-resolution tests**

```ts
import { parseConfig } from '@/sim/config';
import { updateMovement } from '@/sim/movement';
import { cellKey, createWorld } from '@/sim/world';

function twoRobotWorld(mode: 'older' | 'carrying') {
  const world = createWorld(
    parseConfig({
      grid: { width: 5, height: 3 },
      robots: 2,
      pods: { count: 1 },
      stations: [{ id: 'S-1', docks: [[4, 1]], queueCapacity: 2, serviceTimeMs: 1000 }],
      seed: 1,
    }),
  );
  world.robots[0].cell = { x: 0, y: 0 };
  world.robots[0].path = [{ x: 1, y: 0 }];
  world.robots[0].status = 'moving_empty';
  world.robots[0].assignedAtMs = 5;
  world.robots[1].cell = { x: 2, y: 0 };
  world.robots[1].path = [{ x: 1, y: 0 }];
  world.robots[1].status = mode === 'carrying' ? 'moving_loaded' : 'moving_empty';
  world.robots[1].assignedAtMs = 10;
  return world;
}

test('the older assignment wins a contested cell', () => {
  const world = twoRobotWorld('older');
  updateMovement(world);
  const cells = world.robots.map((r) => cellKey(r.cell));
  expect(new Set(cells).size).toBe(2);
  expect(world.robots[0].cell).toEqual({ x: 1, y: 0 });
  expect(world.robots[1].cell).toEqual({ x: 2, y: 0 });
});

test('a carrying robot wins a contested cell over an older empty robot', () => {
  const world = twoRobotWorld('carrying');
  updateMovement(world);
  expect(world.robots[1].cell).toEqual({ x: 1, y: 0 });
  expect(world.robots[0].cell).toEqual({ x: 0, y: 0 });
  expect(world.robots[0].blockedTicks).toBe(1);
});

test('movement resolution is deterministic', () => {
  const a = twoRobotWorld('carrying');
  const b = twoRobotWorld('carrying');
  updateMovement(a);
  updateMovement(b);
  expect(a.robots.map((r) => [r.cell, r.status])).toEqual(
    b.robots.map((r) => [r.cell, r.status]),
  );
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npm test -- tests/movement.test.ts`
Expected: FAIL — `updateMovement` missing.

- [ ] **Step 6: Implement `updateMovement`**

Build occupancy from current cells. Sort robots by priority. For each, consume the next path cell if it is in bounds and free in the working occupancy; apply immediately to the working occupancy so later robots see the new state. Robots that cannot move increment `blockedTicks`, get status `waiting`, and after 10 blocked ticks clear and recompute the path with an extra cost of 3 per robot on a cell and 1 per robot whose next cell is that cell. After all moves, detect wait cycles and apply the sidestep recovery. Do not change `at_station` robots.

- [ ] **Step 7: Verify and commit**

Run: `npm test -- tests/movement.test.ts`
Expected: PASS.

```bash
git add src/sim/movement.ts tests/movement.test.ts
git commit -m "feat: add grid pathfinding and traffic resolution"
```

---

### Task 5: Simulation Lifecycle and Allocation

**Files:**
- Create: `src/sim/allocation.ts`, `src/sim/fcfs.ts`, `src/sim/simulation.ts`, `tests/simulation.test.ts`, `tests/fcfs.test.ts`
- Modify: `src/sim/index.ts` (create barrel export)

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `Allocator` interface: `allocate(observation: AllocationObservation): Promise<Assignment[]> | Assignment[]`.
  - Observation/assignment types below.
  - `FcfsAllocator implements Allocator`.
  - `Simulation` class below.
  - `ApplyResult` and rejection reasons.

```ts
export interface RobotObservation {
  id: string; cell: Cell; status: RobotStatus; battery: number; jobId: string | null;
}
export interface JobObservation {
  id: string; orderId: string; podId: string; pickup: Cell;
  candidateStations: string[]; priority: number; createdAtMs: number;
  dependsOn: string[];
}
export interface StationObservation {
  id: string; queueLength: number; queueCapacity: number;
  serviceTimeMs: number; busy: boolean;
}
export interface AllocationObservation {
  simTimeMs: number; allocationSeq: number;
  robots: RobotObservation[]; jobs: JobObservation[]; stations: StationObservation[];
}
export interface Assignment { jobId: string; robotId: string; stationId: string }
export type RejectReason =
  | 'stale' | 'unknown-job' | 'job-not-ready' | 'unknown-robot'
  | 'robot-not-idle' | 'unknown-station' | 'station-not-candidate'
  | 'duplicate-job' | 'duplicate-robot' | 'station-frozen';
export interface RejectedAssignment { assignment: Assignment; reason: RejectReason }
export interface ApplyResult { accepted: number; rejected: RejectedAssignment[]; stale: boolean }

export interface MetricsSample {
  simTimeMs: number; ordersCompleted: number; jobsCompleted: number;
  throughputPerHour: number; utilisation: number;
  pendingJobs: number; avgQueueLength: number;
}
export interface MetricsSummary {
  simTimeMs: number; ordersCompleted: number; jobsCompleted: number;
  throughputPerHour: number; throughputWindowPerHour: number;
  completionTimeMs: {
    mean: number; p50: number; p90: number; p95: number; p99: number; max: number;
  };
  utilisation: {
    overall: number; idle: number; movingEmpty: number;
    movingLoaded: number; waiting: number; atStation: number;
  };
  jobsPending: number; rejectedAssignments: number; deadlockEvents: number;
  stations: {
    id: string; busyFraction: number; avgQueueLength: number; maxQueueLength: number;
  }[];
}
export interface Snapshot {
  timeMs: number;
  robotIds: string[];
  robots: {
    x: Float32Array; y: Float32Array; state: Uint8Array;
    carrying: Uint8Array; battery: Float32Array;
  };
  pods: { x: Float32Array; y: Float32Array; visible: Uint8Array };
  stations: { id: string; queueLength: number; capacity: number; busy: boolean }[];
  metrics: MetricsSummary;
}

export class Simulation {
  readonly world: World;
  constructor(config: SimConfig);
  get timeMs(): number;
  isAllocationDue(): boolean;
  observe(): AllocationObservation;
  applyAllocation(seq: number, assignments: Assignment[]): ApplyResult;
  skipAllocation(seq: number): void;
  tick(): void;
  getMetrics(): MetricsSummary;
  getTimeSeries(): MetricsSample[];
  getSnapshot(): Snapshot;
}
```

`MetricsSummary`, `MetricsSample`, and `Snapshot` types are introduced here with the fields used in Task 6 and Task 10; Task 6 fills in calculation details.

- [ ] **Step 1: Write the failing allocation-validation tests**

`tests/simulation.test.ts`:

```ts
import { parseConfig } from '@/sim/config';
import { Simulation } from '@/sim/simulation';

function makeSim() {
  return new Simulation(
    parseConfig({
      grid: { width: 10, height: 10 },
      robots: 2,
      pods: { count: 20 },
      stations: [{ id: 'S-1', docks: [[0, 5]], queueCapacity: 2, serviceTimeMs: 1000 }],
      seed: 3,
    }),
  );
}

function addJob(sim: Simulation, orderId = 'O-000001') {
  const id = `J-${String(sim.world.jobs.size + 1).padStart(7, '0')}`;
  if (!sim.world.orders.has(orderId)) {
    sim.world.orders.set(orderId, {
      id: orderId, createdAtMs: 0, jobIds: [], stationId: null,
      podsTotal: 0, podsServiced: 0, packingRemainingMs: null, completedAtMs: null,
    });
  }
  sim.world.orders.get(orderId)!.jobIds.push(id);
  sim.world.jobs.set(id, {
    id, orderId, podId: 'P-00001', pickup: { x: 5, y: 5 },
    candidateStations: ['S-1'], dependsOn: [], priority: 0,
    createdAtMs: 0, status: 'ready', stationId: null, robotId: null,
    completedAtMs: null,
  });
  return id;
}

test('accepts a valid assignment and starts the robot', () => {
  const sim = makeSim();
  sim.world.robots[0].status = 'idle';
  sim.world.robots[0].cell = { x: 0, y: 0 };
  const jobId = addJob(sim);
  const obs = sim.observe();
  const result = sim.applyAllocation(obs.allocationSeq, [
    { jobId, robotId: sim.world.robots[0].id, stationId: 'S-1' },
  ]);
  expect(result.accepted).toBe(1);
  expect(sim.world.robots[0].status).toBe('moving_empty');
  expect(sim.world.jobs.get(jobId)!.status).toBe('assigned');
});

test('rejects duplicate robots and leaves the second job ready', () => {
  const sim = makeSim();
  const robotId = sim.world.robots[0].id;
  const first = addJob(sim);
  const second = addJob(sim);
  const obs = sim.observe();
  const result = sim.applyAllocation(obs.allocationSeq, [
    { jobId: first, robotId, stationId: 'S-1' },
    { jobId: second, robotId, stationId: 'S-1' },
  ]);
  expect(result.accepted).toBe(1);
  expect(result.rejected.map((r) => r.reason)).toContain('duplicate-robot');
  expect(sim.world.jobs.get(second)!.status).toBe('ready');
});

test('rejects a station outside the job candidates', () => {
  const sim = makeSim();
  const jobId = addJob(sim);
  sim.world.stations.push({
    id: 'S-2', docks: [{ x: 9, y: 5 }], queueCapacity: 2,
    serviceTimeMs: 1000, queue: [], serviceRemainingMs: 0,
  });
  const obs = sim.observe();
  const result = sim.applyAllocation(obs.allocationSeq, [
    { jobId, robotId: sim.world.robots[0].id, stationId: 'S-2' },
  ]);
  expect(result.accepted).toBe(0);
  expect(result.rejected[0].reason).toBe('station-not-candidate');
});

test('a stale allocation response is ignored', () => {
  const sim = makeSim();
  const obs = sim.observe();
  sim.applyAllocation(obs.allocationSeq, []);
  const again = sim.applyAllocation(obs.allocationSeq, []);
  expect(again.stale).toBe(true);
  expect(again.accepted).toBe(0);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/simulation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `Simulation` allocation, tick ordering, and station handoff**

`tick()` performs, in order:

1. `world.simTimeMs += tickMs; world.tick += 1`.
2. Generate due orders.
3. Advance station service/absorption, run pod replenishment (place the pod in a free cell chosen by the seeded RNG after `replenishDelayMs`), release dependent jobs whose prerequisites are all complete, and advance order packing/completion.
4. Retry deposits for robots in `at_station`.
5. `updateMovement(world)`.
6. Resolve path-end actions: empty-leg robot at pod cell picks up the pod and plans the loaded leg to the nearest dock; loaded robot at a dock deposits if the queue has room, else becomes `at_station`.
7. Sample time-series metrics when at least 1,000 ms of sim time has elapsed since the last sample.

Allocation: `isAllocationDue()` is true when no allocation is pending and `timeMs >= nextAllocationAtMs` (initial 0). `observe()` sets the pending sequence and returns the observation; calling it while pending throws. `applyAllocation` validates sequentially in returned order; accepted assignments apply together; `skipAllocation` and a successful apply advance `nextAllocationAtMs = timeMs + intervalMs`.

Apply rules: robot must exist, be `idle`, and have no job; job must exist and be `ready`; station must exist and be in the job's current candidates; no duplicate job/robot among accepted entries. On acceptance: set robot `jobId`, `status = 'moving_empty'`, `assignedAtMs`, clear path and blocked count, and plan to the pickup. Freeze `order.stationId` if unset, and rewrite `candidateStations = [stationId]` on the order's other ready jobs. A later entry whose station differs from a frozen order station is rejected as `station-frozen`.

Station deposit: if `queue.length < queueCapacity`, push `{podId, orderId, jobId}`, mark the pod carried=false/available=false, mark the job complete (`completedAtMs` = now), free the robot (`idle`, no job, carrying false), and start service immediately if the queue was empty (`serviceRemainingMs = serviceTimeMs`). Otherwise set the robot `at_station` and retry on later ticks.

Service: when `serviceRemainingMs` reaches 0, pop the first queue entry, mark the pod `available=false, replenishAtMs=now+replenishDelayMs, reservedByJobId=null`, increment the order's `podsServiced`, and start the next queued pod. When `podsServiced === podsTotal`, start packing (`packingRemainingMs = packingTimeMs`). When packing reaches 0, set `completedAtMs` and record the completion duration.

- [ ] **Step 4: Run allocation tests to verify they pass**

Run: `npm test -- tests/simulation.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing station-freeze and full-queue tests**

```ts
test('first accepted trip freezes the order station for later trips', () => {
  const sim = makeSim();
  sim.world.stations.push({
    id: 'S-2', docks: [{ x: 9, y: 5 }], queueCapacity: 2,
    serviceTimeMs: 1000, queue: [], serviceRemainingMs: 0,
  });
  const first = addJob(sim);
  const second = addJob(sim);
  sim.world.jobs.get(first)!.candidateStations = ['S-1', 'S-2'];
  sim.world.jobs.get(second)!.candidateStations = ['S-1', 'S-2'];
  const obs = sim.observe();
  const result = sim.applyAllocation(obs.allocationSeq, [
    { jobId: first, robotId: sim.world.robots[0].id, stationId: 'S-1' },
    { jobId: second, robotId: sim.world.robots[1].id, stationId: 'S-2' },
  ]);
  expect(result.accepted).toBe(1);
  expect(result.rejected[0].reason).toBe('station-frozen');
  expect(sim.world.jobs.get(second)!.candidateStations).toEqual(['S-1']);
});

test('robot waits at a full dock, then deposits when a slot frees', () => {
  const sim = makeSim();
  const station = sim.world.stations[0];
  station.queueCapacity = 1;
  sim.world.orders.set('O-000002', {
    id: 'O-000002', createdAtMs: 0, jobIds: [], stationId: 'S-1',
    podsTotal: 1, podsServiced: 0, packingRemainingMs: null, completedAtMs: null,
  });
  station.queue = [{ podId: 'P-00002', orderId: 'O-000002', jobId: 'J-0000002' }];
  station.serviceRemainingMs = 900;
  const jobId = addJob(sim);
  const robot = sim.world.robots[0];
  robot.cell = { x: 0, y: 5 };
  robot.jobId = jobId;
  robot.carrying = true;
  robot.status = 'moving_loaded';
  robot.path = [];
  sim.tick();
  expect(robot.status).toBe('at_station');
  for (let i = 0; i < 10; i++) sim.tick();
  expect(robot.status).toBe('idle');
  expect(sim.world.jobs.get(jobId)!.status).toBe('complete');
  expect(station.queue).toHaveLength(1);
});
```

- [ ] **Step 6: Run to verify failure, then implement the missing behavior**

Run: `npm test -- tests/simulation.test.ts`
Expected: FAIL on freeze/queue assertions.

Implement freeze rewriting and dock retry/deposit exactly as described in Step 3.

- [ ] **Step 7: Write the failing FCFS tests**

`tests/fcfs.test.ts`:

```ts
import { FcfsAllocator } from '@/sim/fcfs';
import type { AllocationObservation } from '@/sim/allocation';

const observation: AllocationObservation = {
  simTimeMs: 10_000,
  allocationSeq: 1,
  robots: [
    { id: 'R-0001', cell: { x: 0, y: 0 }, status: 'idle', battery: 1, jobId: null },
    { id: 'R-0002', cell: { x: 9, y: 0 }, status: 'idle', battery: 1, jobId: null },
  ],
  jobs: [
    { id: 'J-2', orderId: 'O-2', podId: 'P-2', pickup: { x: 5, y: 0 },
      candidateStations: ['S-1', 'S-2'], priority: 2, createdAtMs: 9000,
      dependsOn: [] },
    { id: 'J-1', orderId: 'O-1', podId: 'P-1', pickup: { x: 5, y: 0 },
      candidateStations: ['S-1', 'S-2'], priority: 1, createdAtMs: 8000,
      dependsOn: [] },
  ],
  stations: [
    { id: 'S-1', queueLength: 3, queueCapacity: 8, serviceTimeMs: 1000, busy: true },
    { id: 'S-2', queueLength: 0, queueCapacity: 8, serviceTimeMs: 1000, busy: false },
  ],
};

test('assigns oldest job to nearest robot and least-penalised station', () => {
  const result = new FcfsAllocator().allocate(observation);
  expect(result[0]).toEqual({ jobId: 'J-1', robotId: 'R-0002', stationId: 'S-2' });
});
```

Use queue penalty `5` per queued pod added to the pickup→nearest-dock Manhattan distance; tie-break by station id. With both stations 10 cells from the pickup, S-1 costs 25 and S-2 costs 10.

- [ ] **Step 8: Implement `FcfsAllocator`**

For jobs sorted by `(createdAtMs, id)`, pick the nearest unused idle robot by Manhattan distance to the pickup (tie: id), then the station with the lowest `pickup→nearest dock` distance plus `5 × queueLength` (tie: id). Return one assignment per job while robots remain. The allocator is synchronous.

- [ ] **Step 9: Verify and commit**

Run: `npm test -- tests/simulation.test.ts tests/fcfs.test.ts`
Expected: PASS.

```bash
git add src/sim/allocation.ts src/sim/fcfs.ts src/sim/simulation.ts src/sim/index.ts tests/simulation.test.ts tests/fcfs.test.ts
git commit -m "feat: add simulation lifecycle, allocation validation, and FCFS"
```

---

### Task 6: Metrics Summary and Time Series

**Files:**
- Create: `src/sim/metrics.ts`, `tests/metrics.test.ts`
- Modify: `src/sim/simulation.ts`, `src/sim/types.ts`

**Interfaces:**
- Produces:
  - `percentile(values: number[], p: number): number` — linear interpolation (R-7); 0 for empty.
  - `MetricsSummary` with `simTimeMs`, `ordersCompleted`, `jobsCompleted`, `throughputPerHour`, `throughputWindowPerHour` (rolling 1 simulated hour), `completionTimeMs: { mean, p50, p90, p95, p99, max }`, `utilisation: { overall, idle, movingEmpty, movingLoaded, waiting, atStation }`, `jobsPending`, `rejectedAssignments`, `deadlockEvents`, `stations: { id, busyFraction, avgQueueLength, maxQueueLength }[]`.
  - `MetricsSample` with `simTimeMs`, `ordersCompleted`, `jobsCompleted`, `throughputPerHour`, `utilisation`, `pendingJobs`, `avgQueueLength`.
  - `Simulation.getMetrics()` and `getTimeSeries()` return the above.
  - `toCsv(samples: MetricsSample[]): string` with header `simTimeMs,ordersCompleted,jobsCompleted,throughputPerHour,utilisation,pendingJobs,avgQueueLength`.

- [ ] **Step 1: Write the failing metrics tests**

```ts
import { percentile, toCsv } from '@/sim/metrics';

test('percentile uses linear interpolation', () => {
  expect(percentile([], 50)).toBe(0);
  expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
  expect(percentile([1, 2, 3, 4], 95)).toBeCloseTo(3.85, 5);
});

test('csv header is stable', () => {
  expect(toCsv([]).trim()).toBe(
    'simTimeMs,ordersCompleted,jobsCompleted,throughputPerHour,utilisation,pendingJobs,avgQueueLength',
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement percentile and CSV**

Sort a copy numerically; index `(n - 1) * p / 100`; interpolate between neighbours. Format utilisation and throughput with fixed precision (4 and 2 decimals respectively) in CSV.

- [ ] **Step 4: Write the failing simulation-metrics test**

```ts
import { parseConfig } from '@/sim/config';
import { Simulation } from '@/sim/simulation';

test('summary reports completions, utilisation, and samples', () => {
  const sim = new Simulation(
    parseConfig({
      grid: { width: 10, height: 10 }, robots: 1, pods: { count: 5 },
      stations: [{ id: 'S-1', docks: [[0, 5]], queueCapacity: 2, serviceTimeMs: 100 }],
      orders: { arrivalRatePerHour: 3600, linesPerOrder: { min: 1, max: 1 }, packingTimeMs: 100 },
      seed: 5,
    }),
  );
  for (let i = 0; i < 50; i++) sim.tick();
  const summary = sim.getMetrics();
  expect(summary.simTimeMs).toBe(5000);
  expect(summary.utilisation.overall).toBeGreaterThanOrEqual(0);
  expect(summary.utilisation.overall).toBeLessThanOrEqual(1);
  expect(sim.getTimeSeries().length).toBe(5);
});
```

- [ ] **Step 5: Implement metric recording and summary**

Track robot state durations on status transitions (add the elapsed segment to the previous state when it changes, and include the open segment at summary time). Utilisation `overall = 1 - idle / (elapsed × robotCount)`; report each state's share of total robot-time. Track completed order durations and order/job completion timestamps. Throughput is cumulative `ordersCompleted / (simTimeMs / 3_600_000)`; the rolling figure counts completions in the last 3,600,000 ms. Rejected assignment count accumulates. Station busy time accumulates per tick when `serviceRemainingMs > 0`; queue length samples update average and maximum. Sample the time series every 1,000 ms of sim time.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- tests/metrics.test.ts tests/simulation.test.ts`
Expected: PASS.

```bash
git add src/sim/metrics.ts src/sim/simulation.ts src/sim/types.ts tests/metrics.test.ts
git commit -m "feat: add metrics summary and time series"
```

---

### Task 7: Headless Runner

**Files:**
- Create: `src/headless/run.ts`, `src/headless/args.ts`, `scripts/run-headless.ts`, `configs/smoke.json`, `tests/headless.test.ts`

**Interfaces:**
- Consumes: `Simulation`, `FcfsAllocator`, `toCsv`, `parseConfig`.
- Produces:
  - `parseDuration(input: string): number` for `ms`, `s`, `m`, `h`.
  - `parseHeadlessArgs(argv: string[]): HeadlessOptions` with `{ configPath, strategy, untilMs, seed, outDir }`.
  - `runHeadless(options: HeadlessOptions): Promise<HeadlessSummary>` writing `summary.json`, `metrics.csv`, `config.resolved.json`.
  - `HeadlessSummary` with `config`, `seed`, `strategy`, `strategyDigest`, `simDurationMs`, `wallTimeMs`, `metrics`.

- [ ] **Step 1: Write the failing duration/args tests**

```ts
import { parseDuration, parseHeadlessArgs } from '@/headless/args';

test('parses durations', () => {
  expect(parseDuration('24h')).toBe(86_400_000);
  expect(parseDuration('90s')).toBe(90_000);
  expect(parseDuration('500ms')).toBe(500);
  expect(() => parseDuration('nope')).toThrow();
});

test('parses headless flags', () => {
  const args = parseHeadlessArgs([
    '--config', 'configs/smoke.json', '--strategy', 'python:auction',
    '--until', '1h', '--seed', '7', '--out', 'results/x',
  ]);
  expect(args).toEqual({
    configPath: 'configs/smoke.json', strategy: 'python:auction',
    untilMs: 3_600_000, seed: 7, outDir: 'results/x',
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/headless.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement argument parsing and the duration parser**

Reject unknown flags and missing values. `--out` defaults to `results/<timestamp>`; `--seed` overrides the config seed; `--strategy` overrides `allocation.strategy`.

- [ ] **Step 4: Create `configs/smoke.json`**

Grid 30×30, 40 robots, 300 pods, two stations, tick 100 ms, allocation every 1,000 ms, 3,600 orders/hour, 1–2 lines, packing 5,000 ms, seed 42.

- [ ] **Step 5: Write the failing headless integration test**

```ts
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runHeadless } from '@/headless/run';

test('runs a short scenario and writes all outputs', async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), 'hive-'));
  const summary = await runHeadless({
    configPath: 'configs/smoke.json', strategy: 'builtin:fcfs',
    untilMs: 60_000, seed: 42, outDir,
  });
  expect(summary.simDurationMs).toBe(60_000);
  expect(summary.metrics.simTimeMs).toBe(60_000);
  const csv = await readFile(path.join(outDir, 'metrics.csv'), 'utf8');
  expect(csv.split('\n')[0]).toBe(
    'simTimeMs,ordersCompleted,jobsCompleted,throughputPerHour,utilisation,pendingJobs,avgQueueLength',
  );
  const written = JSON.parse(await readFile(path.join(outDir, 'summary.json'), 'utf8'));
  expect(written.seed).toBe(42);
});
```

- [ ] **Step 6: Implement `runHeadless` and the CLI wrapper**

Loop while `sim.timeMs < untilMs`: if `sim.isAllocationDue()`, call the allocator with `sim.observe()`; on success apply; on error apply fallback FCFS when `onFailure === 'fallback-fcfs'`, otherwise `skipAllocation`. Then `sim.tick()`. For `builtin:fcfs`, instantiate `FcfsAllocator` directly. For `python:*`, throw a clear "start with Task 9" style error until Task 9 adds the client (Task 9 replaces this with the real client). Compute `strategyDigest` as `'builtin'` for FCFS and the SHA-256 of the strategy file for Python strategies. Write outputs with `mkdir -p` and print:

```
Orders completed: N
Throughput: X/h
Completion p50/p95: A / B ms
Utilisation: P%
Sim: T sim-hours in W wall-seconds (R× real time)
```

- [ ] **Step 7: Write the failing determinism test**

```ts
test('same config, seed, and strategy produce identical metrics', async () => {
  const a = await runHeadless({ configPath: 'configs/smoke.json', strategy: 'builtin:fcfs', untilMs: 120_000, seed: 42, outDir: await mkdtemp(path.join(tmpdir(), 'hive-a-')) });
  const b = await runHeadless({ configPath: 'configs/smoke.json', strategy: 'builtin:fcfs', untilMs: 120_000, seed: 42, outDir: await mkdtemp(path.join(tmpdir(), 'hive-b-')) });
  expect(a.metrics).toEqual(b.metrics);
});
```

- [ ] **Step 8: Run all headless tests**

Run: `npm test -- tests/headless.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/headless scripts/run-headless.ts configs/smoke.json tests/headless.test.ts
git commit -m "feat: add headless runner with deterministic metrics export"
```

---

### Task 8: Python Strategy Sidecar

**Files:**
- Create: `python/hive_sim/__init__.py`, `python/hive_sim/protocol.py`, `python/hive_sim/runner.py`, `python/hive_sim/server.py`, `python/strategies/auction.py`, `python/strategies/fcfs_reference.py`, `python/strategies/nearest_robot.py`, `python/requirements.txt`, `python/requirements-dev.txt`, `python/tests/test_protocol.py`, `python/tests/test_runner.py`, `python/tests/test_server.py`, `python/pytest.ini`

**Interfaces:**
- Consumes: the JSON shape of `AllocationObservation` / `Assignment` from Task 5.
- Produces: HTTP service on `127.0.0.1`:
  - `GET /health` → `{ "status": "ok", "session": string | null }`
  - `GET /strategies` → `{ "strategies": [{ "name": "auction", "description": string }] }`
  - `POST /sessions` body `{ "strategy": "auction", "config": {} }` → `{ "sessionId": string, "strategy": string }`
  - `POST /sessions/{id}/allocate` body is an observation → `{ "assignments": Assignment[], "diagnostics": object }` (500 with `{ "error": string }` on strategy failure)
  - `POST /sessions/{id}/select` body `{ "strategy": "fcfs_reference" }` → `{ "strategy": string }`
  - `POST /sessions/{id}/reset` → `{ "status": "ok" }`; `DELETE /sessions/{id}` → `{ "status": "ok" }`
- Startup prints one line to stdout: `{"type":"hive-sim-sidecar","port":<port>}` and flushes.
- Strategy contract:

```python
class Strategy:
    def __init__(self, config: dict | None = None): ...
    def reset(self) -> None: ...
    def allocate(self, observation: dict) -> list[dict]: ...
```

- [ ] **Step 1: Add dev requirements and tests package**

`python/requirements.txt` contains only a comment: `# Runtime uses the Python standard library only.` `python/requirements-dev.txt` contains `pytest>=8`. `python/pytest.ini`:

```ini
[pytest]
pythonpath = .
testpaths = tests
```

- [ ] **Step 2: Write the failing protocol tests**

```python
from hive_sim.protocol import parse_assignments, observation_summary


def test_parse_assignments_requires_all_fields():
    assert parse_assignments([{"jobId": "J-1", "robotId": "R-1", "stationId": "S-1"}]) == [
        {"jobId": "J-1", "robotId": "R-1", "stationId": "S-1"}
    ]
    with pytest.raises(ValueError):
        parse_assignments([{"jobId": "J-1"}])


def test_observation_summary_counts_entities():
    obs = {"simTimeMs": 0, "allocationSeq": 0, "robots": [{}], "jobs": [{}, {}], "stations": []}
    assert observation_summary(obs) == {"robots": 1, "jobs": 2, "stations": 0}
```

Include `import pytest` in the file.

- [ ] **Step 3: Run to verify failure**

Run: `cd python && python3 -m pytest tests/test_protocol.py -q`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `protocol.py`**

`parse_assignments` validates a list of dicts with exactly the three string keys and returns normalized copies. `observation_summary` returns entity counts.

- [ ] **Step 5: Write the failing loader/state tests**

```python
from hive_sim.runner import StrategySession


def test_state_persists_between_calls():
    session = StrategySession("auction", strategies_dir="strategies")
    first = session.allocate({"simTimeMs": 0, "allocationSeq": 0, "robots": [], "jobs": [], "stations": []})
    second = session.allocate({"simTimeMs": 1000, "allocationSeq": 1, "robots": [], "jobs": [], "stations": []})
    assert first["diagnostics"]["calls"] == 1
    assert second["diagnostics"]["calls"] == 2


def test_select_replaces_the_instance():
    session = StrategySession("auction", strategies_dir="strategies")
    session.allocate({"simTimeMs": 0, "allocationSeq": 0, "robots": [], "jobs": [], "stations": []})
    session.select("fcfs_reference")
    result = session.allocate({"simTimeMs": 0, "allocationSeq": 1, "robots": [], "jobs": [], "stations": []})
    assert result["diagnostics"].get("calls") == 1
```

Make `fcfs_reference.Strategy` also expose `calls` in diagnostics so the assertion holds.

- [ ] **Step 6: Implement the runner and strategies**

`StrategySession` loads `python/strategies/<name>.py` via `importlib.util.spec_from_file_location`, instantiates `Strategy(config)`, and serializes calls behind a `threading.Lock`. Validate returned assignments with `parse_assignments`. Each example strategy returns `{"assignments": [...], "diagnostics": {...}}`; `auction` increments `self.calls` and returns an empty assignment list (a scaffold for users), `fcfs_reference` mirrors the built-in FCFS, `nearest_robot` assigns the closest idle robot.

- [ ] **Step 7: Write the failing server tests**

```python
import json
import threading
import urllib.request
from hive_sim.server import create_server


def start_test_server():
    server = create_server(port=0, strategies_dir="strategies")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def post(url, payload):
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


def test_session_lifecycle():
    server, base = start_test_server()
    try:
        health = json.loads(urllib.request.urlopen(f"{base}/health").read())
        assert health["status"] == "ok"
        created = post(f"{base}/sessions", {"strategy": "auction", "config": {}})
        session_id = created["sessionId"]
        result = post(f"{base}/sessions/{session_id}/allocate", {
            "simTimeMs": 0, "allocationSeq": 0, "robots": [], "jobs": [], "stations": [],
        })
        assert result["diagnostics"]["calls"] == 1
        selected = post(f"{base}/sessions/{session_id}/select", {"strategy": "fcfs_reference"})
        assert selected["strategy"] == "fcfs_reference"
    finally:
        server.shutdown()
```

- [ ] **Step 8: Implement the stdlib HTTP server**

`create_server(port, strategies_dir)` returns `ThreadingHTTPServer` with a request handler. Support CORS: echo `Access-Control-Allow-Origin` for origins starting with `http://localhost` or `http://127.0.0.1`, allow `GET, POST, DELETE, OPTIONS`, and allow `Content-Type`. `main()` parses `--port` (default 0) and `--strategies-dir` (default resolves to `<repo>/python/strategies` from `__file__` so auto-start works from any cwd), prints the handshake line, and serves until SIGINT/SIGTERM. Use one session map guarded by a lock.

- [ ] **Step 9: Run the Python suite**

Run: `cd python && python3 -m pytest -q`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add python
git commit -m "feat: add stdlib Python strategy sidecar"
```

---

### Task 9: Python Client, Auto-Start, and Discovery Routes

**Files:**
- Create: `src/lib/allocator.ts`, `src/lib/pythonAllocator.ts`, `src/server/pythonSidecar.ts`, `src/server/discovery.ts`, `src/app/api/sim-config/route.ts`, `src/app/api/configs/route.ts`, `src/instrumentation.ts`, `tests/pythonAllocator.test.ts`, `tests/sidecar.test.ts`, `tests/apiRoutes.test.ts`
- Modify: `src/headless/run.ts` to use the real Python allocator for `python:*`

**Interfaces:**
- Consumes: Python endpoints from Task 8; `Allocator`, `AllocationObservation`, `Assignment` from Task 5.
- Produces:
  - `Allocator` interface and errors `AllocatorError`, `AllocatorTimeoutError` in `src/lib/allocator.ts`.
  - `PythonAllocator` with `constructor({ baseUrl, strategy, timeoutMs })`, `allocate(observation): Promise<Assignment[]>`, `select(strategy): Promise<void>`, `dispose(): Promise<void>`.
  - `createAllocator(strategy: string, options): Allocator` (in `src/lib/allocator.ts`) returning FCFS for `builtin:fcfs` or `PythonAllocator` otherwise.
  - `startPythonSidecar(): Promise<SidecarInfo>` and `getSidecarInfo(): SidecarInfo` with `{ url: string | null, online: boolean, strategies: string[] }`.
  - `getSimConfigResponse()` and `getConfigsResponse()` used by the API routes.

- [ ] **Step 1: Write the failing client tests**

```ts
import { createServer } from 'node:http';
import { createAllocator, AllocatorError } from '@/lib/allocator';
import { PythonAllocator, AllocatorTimeoutError } from '@/lib/pythonAllocator';

function observation() {
  return { simTimeMs: 0, allocationSeq: 0, robots: [], jobs: [], stations: [] };
}

test('posts the observation and returns assignments', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ assignments: [{ jobId: 'J-1', robotId: 'R-1', stationId: 'S-1' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const allocator = new PythonAllocator({ baseUrl: `http://127.0.0.1:${port}`, strategy: 'auction', timeoutMs: 500 });
  await expect(allocator.allocate(observation() as any)).resolves.toEqual([
    { jobId: 'J-1', robotId: 'R-1', stationId: 'S-1' },
  ]);
  await allocator.dispose();
  server.close();
});

test('times out and raises AllocatorTimeoutError', async () => {
  const server = createServer(() => { /* never respond */ });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const allocator = new PythonAllocator({ baseUrl: `http://127.0.0.1:${port}`, strategy: 'auction', timeoutMs: 50 });
  await expect(allocator.allocate(observation() as any)).rejects.toBeInstanceOf(AllocatorTimeoutError);
  await allocator.dispose();
  server.close();
});
```

The fake server must also answer `POST /sessions` for the lazy session creation; return `{ sessionId: 's1', strategy: 'auction' }` when `req.url === '/sessions'`. Call `server.closeAllConnections()` before `server.close()` in the timeout test so the open socket does not hang the runner.

Add a third test: `createAllocator('python:auction', { pythonUrl: null, timeoutMs: 100 })` throws `AllocatorError` so a missing sidecar fails clearly.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/pythonAllocator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the client**

Create the session lazily on the first `allocate` (`POST /sessions`), then `POST /sessions/{id}/allocate`. Use `AbortSignal.timeout(timeoutMs)`; map aborts to `AllocatorTimeoutError`, non-2xx or `{error}` to `AllocatorError`, and malformed payloads to `AllocatorError`. `select` posts to `/select`; `dispose` DELETEs the session.

- [ ] **Step 4: Write the failing sidecar integration test**

```ts
import { startPythonSidecar } from '@/server/pythonSidecar';

test('starts the Python sidecar and lists strategies', async () => {
  const info = await startPythonSidecar();
  expect(info.online).toBe(true);
  expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(info.strategies).toContain('auction');
});
```

- [ ] **Step 5: Implement the sidecar manager**

`startPythonSidecar` spawns `process.env.HIVE_PYTHON ?? 'python3'` with `-m hive_sim.server --port 0`, cwd at the repo root, and `PYTHONPATH=<repo>/python`. Read stdout line by line until the handshake JSON appears (10 s timeout), then probe `/health` and `/strategies`. Cache a singleton in `globalThis` (survives dev HMR). On spawn failure or timeout, log a warning and return `{ url: null, online: false, strategies: ['builtin:fcfs'] }`. Register SIGINT/SIGTERM and process-exit cleanup once so the child never outlives the parent. `getSidecarInfo()` returns the cached value, probing `/strategies` when online.

- [ ] **Step 6: Write the failing API-helper tests**

```ts
import { getSimConfigResponse, getConfigsResponse } from '@/server/discovery';

test('sim-config always includes builtin:fcfs', async () => {
  const response = await getSimConfigResponse();
  expect(response.strategies).toContain('builtin:fcfs');
});

test('config list contains smoke.json', async () => {
  expect((await getConfigsResponse()).map((c) => c.name)).toContain('smoke');
});
```

- [ ] **Step 7: Implement discovery and routes**

`src/server/discovery.ts` exports the two functions. `/api/sim-config` and `/api/configs` are thin `GET` handlers returning them as JSON. Config entries are `{ name, config }` parsed with `parseConfig`; skip invalid files with a console warning. Add `src/instrumentation.ts`:

```ts
export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build'
  ) {
    const { startPythonSidecar } = await import('./server/pythonSidecar');
    await startPythonSidecar();
  }
}
```

- [ ] **Step 8: Wire `python:*` into the headless runner**

In `runHeadless`, use `createAllocator(strategy, { pythonUrl, timeoutMs: config.allocation.timeoutMs })`; when the strategy is Python, start the sidecar first and dispose it in a `finally`. On allocator error, apply FCFS when `onFailure === 'fallback-fcfs'`, else `skipAllocation`.

- [ ] **Step 9: Verify and commit**

Run: `npm test -- tests/pythonAllocator.test.ts tests/sidecar.test.ts tests/apiRoutes.test.ts`
Expected: PASS.

```bash
git add src/lib/allocator.ts src/lib/pythonAllocator.ts src/server src/app/api src/instrumentation.ts src/headless/run.ts tests/pythonAllocator.test.ts tests/sidecar.test.ts tests/apiRoutes.test.ts
git commit -m "feat: connect simulation to Python allocator with auto-start"
```

---

### Task 10: Sim Loop, Worker Protocol, and Worker Client

**Files:**
- Create: `src/lib/simLoop.ts`, `src/worker/protocol.ts`, `src/worker/sim.worker.ts`, `src/lib/simClient.ts`, `tests/simLoop.test.ts`, `tests/workerProtocol.test.ts`, `tests/simClient.test.ts`

**Interfaces:**
- Consumes: `Simulation`, `Allocator`, `FcfsAllocator`, `Snapshot`, `MetricsSummary`, `PythonAllocator`.
- Produces:
  - `SimLoop`:
    ```ts
    class SimLoop {
      constructor(options: {
        sim: Simulation; allocator: Allocator; tickMs: number;
        now?: () => number; onSnapshot?: (snapshot: Snapshot) => void;
        snapshotIntervalMs?: number;
      });
      start(): void;
      pause(): void;
      step(): Promise<void>;
      setSpeed(multiplier: number): void;
      setAllocator(allocator: Allocator): void;
      advanceTo(nowMs: number): Promise<void>;
      get running(): boolean;
    }
    ```
  - `encodeSnapshot(snapshot: Snapshot): SerializedSnapshot` where robot fields are typed arrays and `buffers: ArrayBuffer[]` are transferable.
  - `WorkerCommand` / `WorkerEvent` unions.
  - `SimClient` wrapping a `WorkerLike` (`postMessage`, `addEventListener`, `terminate`) with `init(config, options)`, `play()`, `pause()`, `step()`, `setSpeed(n)`, `selectStrategy(id)`, `restart(config)`, `inspect(target)`, `onSnapshot(cb)`, `onMetrics(cb)`, `onStatus(cb)`, `onInspection(cb)`, `dispose()`.

- [ ] **Step 1: Write the failing SimLoop tests**

```ts
import { parseConfig } from '@/sim/config';
import { FcfsAllocator } from '@/sim/fcfs';
import { Simulation } from '@/sim/simulation';
import { SimLoop } from '@/lib/simLoop';

const baseConfig = {
  grid: { width: 10, height: 10 },
  robots: 2,
  pods: { count: 20 },
  stations: [{ id: 'S-1', docks: [[0, 5]], queueCapacity: 2, serviceTimeMs: 1000 }],
  seed: 1,
};

function makeLoop(configOverrides = {}) {
  const sim = new Simulation(parseConfig({ ...baseConfig, ...configOverrides }));
  let now = 0;
  const loop = new SimLoop({ sim, allocator: new FcfsAllocator(), tickMs: 100, now: () => now });
  return { sim, loop, setNow: (value: number) => { now = value; } };
}

test('one tick per 100 ms at 1x', async () => {
  const { sim, loop, setNow } = makeLoop();
  setNow(100);
  await loop.advanceTo(100);
  expect(sim.timeMs).toBe(100);
});

test('two ticks per 100 ms at 2x', async () => {
  const { sim, loop, setNow } = makeLoop();
  loop.setSpeed(2);
  setNow(100);
  await loop.advanceTo(100);
  expect(sim.timeMs).toBe(200);
});

test('pauses at an allocation boundary until the allocator resolves', async () => {
  const sim = new Simulation(parseConfig(baseConfig));
  let now = 0;
  let resolve!: (value: never[]) => void;
  let calls = 0;
  const allocator = {
    allocate: () =>
      ++calls === 1
        ? new Promise<never[]>((r) => { resolve = r; })
        : Promise.resolve([]),
  };
  const loop = new SimLoop({ sim, allocator, tickMs: 100, now: () => now });
  now = 1000;
  const pending = loop.advanceTo(1000);
  await Promise.resolve();
  expect(sim.timeMs).toBe(0);
  resolve([]);
  await pending;
  expect(sim.timeMs).toBe(1000);
});
```

`advanceTo` processes allocations due at `t=0` and at interval boundaries. Because the pending promise is unresolved, the sim must not advance. `setSpeed` clamps the multiplier to `[0.25, 16]`.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/simLoop.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `SimLoop`**

Maintain `lastNowMs`, `tickBudget`, `running`, and `speed`. Serialize overlapping `advanceTo` calls through an internal promise chain so a timer cannot re-enter while an allocation is pending. `advanceTo(now)` adds `(now - lastNowMs) * speed / tickMs` to the budget, then while the budget is at least 1 and not waiting: if allocation is due, observe and await the allocator with fallback handling, then continue; otherwise `sim.tick()` and subtract 1. `onSnapshot` fires at most every `snapshotIntervalMs` (default 50 ms wall time). Errors from the allocator trigger FCFS fallback when `config.allocation.onFailure === 'fallback-fcfs'`, otherwise `sim.skipAllocation(seq)`. Never apply a stale sequence: catch `stale: true` results and ignore them.

- [ ] **Step 4: Write the failing protocol tests**

```ts
import { encodeSnapshot, decodeSnapshotEvent } from '@/worker/protocol';

test('snapshot buffers survive a structured-clone-style round trip', () => {
  const snapshot = {
    timeMs: 1000,
    robotIds: ['R-0001'],
    robots: {
      x: new Float32Array([3]), y: new Float32Array([4]),
      state: new Uint8Array([1]), carrying: new Uint8Array([0]),
      battery: new Float32Array([1]),
    },
    pods: { x: new Float32Array([9]), y: new Float32Array([9]), visible: new Uint8Array([1]) },
    stations: [{ id: 'S-1', queueLength: 1, capacity: 8, busy: true }],
    metrics: {} as any,
  };
  const encoded = encodeSnapshot(snapshot);
  const decoded = decodeSnapshotEvent({ type: 'snapshot', ...encoded } as any);
  expect(decoded.robotIds).toEqual(['R-0001']);
  expect(Array.from(decoded.robots.x)).toEqual([3]);
  expect(decoded.stations[0].queueLength).toBe(1);
});
```

- [ ] **Step 5: Implement the protocol and worker**

Define:

```ts
export type WorkerCommand =
  | { type: 'init'; config: SimConfig; options: { strategy: string; pythonUrl: string | null; speed: number } }
  | { type: 'play' } | { type: 'pause' } | { type: 'step' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'selectStrategy'; strategy: string }
  | { type: 'restart'; config: SimConfig }
  | { type: 'inspect'; target: InspectionTarget | null };

export type WorkerEvent =
  | { type: 'ready'; robotIds: string[]; stationIds: string[] }
  | { type: 'status'; running: boolean; simTimeMs: number; effectiveSpeed: number; pythonOnline: boolean; error: string | null; metrics: MetricsSummary }
  | { type: 'snapshot'; meta: SnapshotMeta; buffers: ArrayBuffer[]; metrics: MetricsSummary }
  | { type: 'inspection'; target: InspectionTarget; detail: InspectionDetail | null };
```

`SnapshotMeta` excludes typed arrays and includes robot/station IDs. The worker instantiation uses `new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' })` from the client, or `new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })` from within `src/worker`.

The worker owns `Simulation`, `SimLoop`, and the allocator; publishes snapshots every 50 ms and status/metrics every 200 ms; destroys and recreates on `restart`; builds a new allocator on `selectStrategy` (`builtin:fcfs` or `PythonAllocator`); answers `inspect` from the current world at 200 ms cadence while a target is selected.

- [ ] **Step 6: Write the failing SimClient test**

```ts
import { SimClient } from '@/lib/simClient';

class FakeWorker {
  messages: any[] = [];
  listeners: ((event: MessageEvent) => void)[] = [];
  postMessage(message: any) { this.messages.push(message); }
  addEventListener(_type: string, listener: (event: MessageEvent) => void) { this.listeners.push(listener); }
  terminate() {}
  emit(data: any) { for (const listener of this.listeners) listener({ data } as MessageEvent); }
}

test('forwards commands and dispatches metrics from status events', () => {
  const worker = new FakeWorker();
  const client = new SimClient(worker as any);
  client.pause();
  expect(worker.messages.at(-1)).toEqual({ type: 'pause' });
  const received: any[] = [];
  client.onMetrics((metrics) => received.push(metrics));
  worker.emit({
    type: 'status', running: false, simTimeMs: 0, effectiveSpeed: 1,
    pythonOnline: false, error: null, metrics: { ordersCompleted: 3 },
  });
  expect(received).toHaveLength(1);
  expect(received[0].ordersCompleted).toBe(3);
});
```

Add a second test that emits a snapshot event and asserts `onSnapshot` receives decoded arrays.

- [ ] **Step 7: Implement `SimClient`**

Attach one message listener, route by event type, decode snapshots, and maintain unsubscribe functions. `init` stores the config and posts the command.

- [ ] **Step 8: Verify and commit**

Run: `npm test -- tests/simLoop.test.ts tests/workerProtocol.test.ts tests/simClient.test.ts`
Expected: PASS.

```bash
git add src/lib/simLoop.ts src/worker src/lib/simClient.ts tests/simLoop.test.ts tests/workerProtocol.test.ts tests/simClient.test.ts
git commit -m "feat: add simulation loop, worker protocol, and worker client"
```

---

### Task 11: HUD Layout A

**Files:**
- Create: `src/lib/hudStore.ts`, `src/components/hud/Hud.tsx`, `src/components/hud/TopBar.tsx`, `src/components/hud/MetricsPanel.tsx`, `src/components/hud/InspectorPanel.tsx`, `src/components/hud/TransportDock.tsx`, `src/components/hud/Sparkline.tsx`, `tests/hud.test.tsx`
- Modify: `src/app/globals.css`, `src/app/page.tsx`

**Interfaces:**
- Consumes: `SimClient` (Task 10), `MetricsSummary`, `InspectionDetail`.
- Produces: layout-A HUD with props `{ client: SimClient; state: HudState }` and a Zustand store with `running`, `speed`, `simTimeMs`, `metrics`, `strategies`, `strategy`, `scenarioName`, `scenarios`, `pythonOnline`, `selected`, `inspection`, `error`, plus actions `applyStatus`, `applyMetrics`, `setSelected`, `setStrategy`, `setScenario`, `applyInspection`.

- [ ] **Step 1: Write the failing HUD test**

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { Hud } from '@/components/hud/Hud';
import { createHudStore } from '@/lib/hudStore';

test('renders live metrics and sends run commands', () => {
  const calls: string[] = [];
  const client = { play: () => calls.push('play'), pause: () => calls.push('pause') } as any;
  const state = createHudStore({
    running: false, speed: 1, simTimeMs: 4000,
    metrics: {
      simTimeMs: 4000, ordersCompleted: 12, jobsCompleted: 30,
      throughputPerHour: 1080, throughputWindowPerHour: 1080,
      completionTimeMs: { mean: 1, p50: 5000, p90: 1, p95: 14000, p99: 1, max: 1 },
      utilisation: { overall: 0.87, idle: 0.13, movingEmpty: 0.2, movingLoaded: 0.3, waiting: 0.2, atStation: 0.17 },
      jobsPending: 7, rejectedAssignments: 0, deadlockEvents: 0, stations: [],
    },
    strategies: ['builtin:fcfs'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke', scenarios: [{ name: 'smoke', config: {} as any }],
    pythonOnline: false, selected: null, inspection: null, error: null,
  });
  render(<Hud client={client} state={state} />);
  expect(screen.getByText('1,080/h')).toBeInTheDocument();
  expect(screen.getByText('87%')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /play/i }));
  expect(calls).toEqual(['play']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/hud.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store and panels**

`createHudStore(initial)` returns a Zustand v5 store; `useHudStore` is the default app store. HUD structure:

- `TopBar`: `HIVE-1`, scenario name, active strategy, sim clock (`t+ HH:MM:SS`).
- `MetricsPanel` (top-left): throughput, orders done, p50/p95, utilisation, `Sparkline` of the last 120 throughput samples (`applyMetrics` appends to a derived `throughputHistory` capped at 120 entries).
- `InspectorPanel` (top-right): selected robot (`state`, battery, job, trip progress) or station (`queue/capacity`, busy); placeholder when nothing selected.
- `TransportDock` (bottom-centre): play/pause, step, speed `0.25×–16×`, strategy `<select>`, state legend.

Use fixed glass-panel styling from the mockup: `position: fixed`, `background: rgba(13,20,24,.88)`, `border: 1px solid rgba(120,170,160,.25)`, `backdrop-filter: blur(6px)`. Format throughput with `Intl.NumberFormat('en-US')` and utilisation as a whole percentage.

- [ ] **Step 4: Run the HUD test**

Run: `npm test -- tests/hud.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hudStore.ts src/components/hud src/app/globals.css src/app/page.tsx tests/hud.test.tsx
git commit -m "feat: add layout A HUD with live metrics and transport controls"
```

---

### Task 12: React Three Fiber Hive Scene

**Files:**
- Create: `src/components/hive/HiveCanvas.tsx`, `RobotInstances.tsx`, `PodInstances.tsx`, `StationMeshes.tsx`, `GridFloor.tsx`, `render.ts`, `src/lib/snapshotSource.ts`, `tests/render.test.ts`
- Modify: `src/app/page.tsx`, `package.json` (dev deps for jsdom already present)

**Interfaces:**
- Consumes: `Snapshot`, `SimClient`.
- Produces:
  - `cellToWorld(cell: Cell, grid: GridConfig, cellSize?: number): { x: number; z: number }`.
  - `interpolate(a: number, b: number, alpha: number): number`.
  - `stateColor(status: RobotStatus): string` with values: idle `#5f7d8c`, moving_empty `#e8a33d`, moving_loaded `#d8e8e2`, waiting `#c0442f`, at_station `#9b6bd6`.
  - `SnapshotSource` keeping the last two snapshots and exposing `latest()` and `sample(nowMs): { snapshot, alpha }`.
  - `HiveCanvas` accepting `{ source: SnapshotSource; onSelect(target): void }`.

- [ ] **Step 1: Write the failing render-helper tests**

```ts
import { cellToWorld, interpolate, stateColor } from '@/components/hive/render';

test('cell centres map to a centred world', () => {
  expect(cellToWorld({ x: 0, y: 0 }, { width: 100, height: 100 })).toEqual({ x: -49.5, z: -49.5 });
  expect(cellToWorld({ x: 99, y: 99 }, { width: 100, height: 100 })).toEqual({ x: 49.5, z: 49.5 });
});

test('interpolates linearly', () => {
  expect(interpolate(1, 3, 0.25)).toBe(1.5);
});

test('state colours are stable', () => {
  expect(stateColor('idle')).toBe('#5f7d8c');
  expect(stateColor('waiting')).toBe('#c0442f');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/render.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure render helpers and `SnapshotSource`**

`SnapshotSource.push(snapshot, receivedAtMs)` replaces `previous` and `current`. `sample(nowMs)` returns `{ snapshot: current, alpha: clamp((nowMs - previousAtMs) / (currentAtMs - previousAtMs), 0, 1) }` with positions blended between the snapshots by the renderer.

- [ ] **Step 4: Implement the scene**

- `GridFloor`: a 100×100 plane at y=0 in `#0a0f0d` with a grid helper (or shader lines) in `#3c5a50` at low opacity.
- `RobotInstances`: one `instancedMesh` with a box geometry (`0.7 × 0.35 × 0.7`) and up to `config.robots` instances. In `useFrame`, write matrices from interpolated positions at `y=0.4`; when `carrying`, raise to `y=0.55` and show a small pod block above. Set per-instance colour from `stateColor`. Use `instanceColor.needsUpdate` only when colours change. Clicking yields `event.instanceId`, mapped to `snapshot.robotIds[index]`.
- `PodInstances`: one `instancedMesh` of small cylinders at y=0.15; hide invisible pods by scaling to 0. Pod positions only change on replenishment, so update matrices when the visible buffer differs.
- `StationMeshes`: one box per station placed just outside the nearest grid edge at the docks' side, with a label via Drei `<Html>` or `<Text>` (choose `<Text>` for performance); clicking selects the station.
- `HiveCanvas`: `<Canvas camera={{ position: [0, 90, 90], fov: 45 }}>` with `OrbitControls` (Drei), ambient + directional lights, the floor, pods, stations, robots, and a fog-free dark background. Use `<Suspense fallback={null}>`. `frameloop="always"`.
- Page: dynamic import `HiveCanvas` with `ssr: false`; create `SimClient` and `SnapshotSource` in a client component, initialize with the default config from `/api/configs`, and mount HUD + canvas.

- [ ] **Step 5: Run tests and build**

Run: `npm test -- tests/render.test.ts && npm run build`
Expected: PASS and build exits 0.

- [ ] **Step 6: Manually verify the scene**

Run: `npm run dev`, open `http://localhost:3000`, and confirm robots, pods, stations, grid, and camera controls render; the sim clock advances; no console errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/hive src/lib/snapshotSource.ts src/app/page.tsx
git commit -m "feat: add instanced R3F hive scene with interpolated snapshots"
```

---

### Task 13: Inspection, Strategy Hot-Swap, and Scenario Loading

**Files:**
- Create: `tests/interaction.test.tsx`, `src/components/hud/useSimConnection.ts`
- Modify: `src/components/hud/Hud.tsx`, `src/components/hud/InspectorPanel.tsx`, `src/components/hive/HiveCanvas.tsx`, `src/app/page.tsx`, `src/lib/hudStore.ts`, `src/worker/sim.worker.ts`

**Interfaces:**
- Consumes: Tasks 9–12.
- Produces: end-to-end interactive app: clicking a robot/station inspects it; strategy select hot-swaps; scenario select restarts; Python status badge; pause/step/speed wired.

- [ ] **Step 1: Write the failing interaction test**

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { Hud } from '@/components/hud/Hud';
import { createHudStore } from '@/lib/hudStore';

test('selecting a strategy hot-swaps it', () => {
  const calls: string[] = [];
  const client = { selectStrategy: (id: string) => calls.push(id) } as any;
  const state = createHudStore({
    running: true, speed: 1, simTimeMs: 0, metrics: null,
    strategies: ['builtin:fcfs', 'python:auction'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke', scenarios: [{ name: 'smoke', config: {} as any }],
    pythonOnline: true, selected: null, inspection: null, error: null,
  });
  render(<Hud client={client} state={state} />);
  fireEvent.change(screen.getByLabelText(/algorithm/i), { target: { value: 'python:auction' } });
  expect(calls).toEqual(['python:auction']);
});

test('clicking a station asks the worker to inspect it', () => {
  const calls: any[] = [];
  const client = { inspect: (target: any) => calls.push(target) } as any;
  const state = createHudStore({
    running: true, speed: 1, simTimeMs: 0, metrics: null,
    strategies: ['builtin:fcfs'], strategy: 'builtin:fcfs',
    scenarioName: 'smoke', scenarios: [{ name: 'smoke', config: {} as any }],
    pythonOnline: false, selected: null, inspection: null, error: null,
  });
  render(<Hud client={client} state={state} />);
  state.getState().setSelected({ type: 'station', id: 'S-1' });
  expect(calls).toEqual([{ type: 'station', id: 'S-1' }]);
});
```

Use an effect in `Hud` that calls `client.inspect(selected)` whenever `selected` changes to a non-null value, and `client.inspect(null)` when it is cleared.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/interaction.test.tsx`
Expected: FAIL — missing label/behavior.

- [ ] **Step 3: Implement the wiring**

- `useSimConnection(client)` subscribes to snapshot/metrics/status/inspection events, pushes snapshots into `SnapshotSource`, throttles metrics into the store to 5 Hz, and maps status into the store.
- Strategy `<select aria-label="Algorithm">` calls `client.selectStrategy(id)` and updates the store optimistically.
- Scenario `<select aria-label="Scenario">` calls `client.restart(config)`.
- `selected` changes call `client.inspect(selected)`; inspection events populate the inspector.
- Python badge shows `Python online` or `Python offline — FCFS only` based on `pythonOnline`.
- Worker inspection payload: for a robot, `{ state, battery, jobId, orderId, stationId, tripProgress: { pathRemaining, carrying } }`; for a station, `{ queueLength, queueCapacity, busy, serviceRemainingMs }`.

- [ ] **Step 4: Verify tests and build**

Run: `npm test -- tests/interaction.test.tsx && npm run build`
Expected: PASS and build exits 0.

- [ ] **Step 5: Manual end-to-end check**

With `npm run dev`: start a run, pause, step, change speed, switch to `python:auction` (with the auto-started sidecar), click a robot and a station, and restart with `smoke` config. Confirm no console errors and the inspector updates.

- [ ] **Step 6: Commit**

```bash
git add src/components/hud src/components/hive/HiveCanvas.tsx src/lib/hudStore.ts src/worker/sim.worker.ts src/app/page.tsx tests/interaction.test.tsx
git commit -m "feat: wire inspection, strategy hot-swap, and scenario loading"
```

---

### Task 14: Scenario Defaults, Benchmark, and Documentation

**Files:**
- Create: `configs/default.json`, `scripts/benchmark.ts`, `README.md`, `docs/benchmarks.md`, `tests/configs.test.ts`
- Modify: `package.json` scripts if needed

**Interfaces:**
- Produces: runnable default scenario, benchmark command, user documentation covering setup, strategy authoring, metrics, and architecture.

- [ ] **Step 1: Write the failing config-files test**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { parseConfig } from '@/sim/config';

test('every config parses and the default matches the spec targets', () => {
  const files = readdirSync('configs').filter((f) => f.endsWith('.json'));
  expect(files).toContain('default.json');
  for (const file of files) {
    expect(() => parseConfig(JSON.parse(readFileSync(`configs/${file}`, 'utf8')))).not.toThrow();
  }
  const config = parseConfig(JSON.parse(readFileSync('configs/default.json', 'utf8')));
  expect(config.grid).toEqual({ width: 100, height: 100 });
  expect(config.robots).toBe(2000);
  expect(config.pods.count).toBe(6000);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/configs.test.ts`
Expected: FAIL — `default.json` missing.

- [ ] **Step 3: Add the default scenario**

`configs/default.json` uses the Global Constraints values with three stations and `"strategy": "builtin:fcfs"`.

- [ ] **Step 4: Implement the benchmark script**

`scripts/benchmark.ts` runs `runHeadless` twice (default config, 1 hour sim; optional `--hours 24`), prints wall time and the ratio `simHoursPerWallHour`, and writes `docs/benchmarks.md` with date, machine info (`os.cpus()[0].model`, `os.totalmem()`), config, wall time, sim duration, ratio, and key metrics. Exit non-zero if the ratio is below 1.0.

- [ ] **Step 5: Write the README**

Cover: prerequisites, `npm install`, `npm run dev`, `npm run sim -- --config configs/default.json --strategy builtin:fcfs --until 24h`, Python strategy authoring with a minimal class, available endpoints, metrics definitions, how determinism works (seed + pause-at-allocation), performance targets, and how to add a config.

- [ ] **Step 6: Run the full verification suite**

Run:

```bash
npm run lint
npm test
npm run build
cd python && python3 -m pytest -q
```

Expected: all pass.

- [ ] **Step 7: Run the benchmark and the browser checklist**

Run: `npm run benchmark -- --hours 1`
Expected: exit 0 with ratio > 1.0; write the measured number into `docs/benchmarks.md`.

Then `npm run dev` and check the 2,000-robot default scenario: ≥30 fps while the sim advances at 1×, pause/step/speed work, allocator switches, inspection works, and no console errors. Record the machine and result in `docs/benchmarks.md`.

- [ ] **Step 8: Commit**

```bash
git add configs/default.json scripts/benchmark.ts README.md docs/benchmarks.md tests/configs.test.ts
git commit -m "docs: add default scenario, benchmark, and user guide"
```

---

## Self-Review Checklist

- **Spec coverage:** §7.1 world → Task 3; §7.2 movement → Task 4; §7.3 jobs/orders/packing → Tasks 3 and 5; §7.4 allocation/FCFS → Task 5; §7.5 metrics → Task 6; §7.6 determinism → Tasks 3, 4, 7; §7.7 timing → Task 10; §8 Python interface → Tasks 8–9; §9 live view → Tasks 11–13; §10 headless → Task 7; §11 config → Tasks 2 and 14; §12 architecture → Tasks 1, 10, 12; §13 testing → every task plus Task 14; §14 success criteria → Tasks 7, 10, 12, 14.
- **Type consistency:** `AllocationObservation`, `Assignment`, `Simulation`, `Allocator`, `Snapshot`, and `MetricsSummary` names are used identically across Tasks 5–13.
- **Review Focus tests:** invalid output (Task 5), full queue (Task 5), timeout/stale (Tasks 5, 10), Python failure (Tasks 9, 10), determinism (Tasks 3, 4, 7).
