# Robotic Hive Warehouse Simulator — Design

**Date:** 2026-10-18
**Repo:** https://github.com/automaticdai/robotic-hive-warehouse-scheduling
**Status:** Design for approval

## 1. Intent and why

Build a local research harness for **task allocation** in an Ocado-style hive warehouse. A job arrives, the allocator decides which robot takes it and which station it goes to, and the consequences — travel, queueing, congestion — play out physically. The tool exists to compare scheduling/allocation policies, with FCFS as a baseline and custom policies written in Python.

Two modes share one deterministic simulation core:

1. **Live 3D mode** — watch up to 2,000 robots on a 100×100 grid, inspect robots and stations, change speed, swap allocators mid-run.
2. **Headless mode** — run long scenarios faster than real time and emit comparable metrics (throughput, order completion times, utilisation).

Success is measured by whether a researcher can drop a new Python strategy into a folder, run it in both modes without touching TypeScript, and trust the numbers enough to compare policies.

## 2. Goals

- Simulate an Ocado-style hive: grid robots carrying pods to stations.
- Scale to **2,000 robots on a 100×100 grid** in the browser at **≥30 fps**.
- Headless runs **faster than real time**, deterministic for a given config + seed + strategy.
- Allocator interface: a **stateful Python class**, loaded by an auto-started local service.
- The allocator receives the **entire ready batch** (ready jobs, fleet state, station state) each allocation tick and returns robot **and** station assignments.
- Built-in **FCFS** baseline that works with no Python running.
- Live view: pause/step, speed control, allocator hot-swap, robot/station inspection, live metrics.
- Metrics: **throughput, order completion-time distribution, robot utilisation** (plus supporting traffic and station metrics).
- Configurable synthetic workload: grid, robot count, stations, pod pool, order arrival rate, order size, seed.

## 3. Non-goals

- No charging drain or charge scheduling in v1. Battery is present in state/API and always 100%.
- No pod return leg. Pods are absorbed at stations and replenished in storage.
- No SKU/inventory or replenishment-planning logic.
- No real order-data import.
- No multi-user, authentication, or cloud deployment. Local single-user tool.
- No formal deadlock-free MAPF guarantee; movement is best-effort with detection and recovery.
- No physics engine, 3D collision, or high-fidelity robot animation.
- No mobile layout.

## 4. Anti-goals (what would count as failure even if it technically runs)

- A beautiful 3D view that cannot sustain 2,000 robots interactively.
- Adding or changing an allocator requires editing TypeScript.
- Headless results cannot be reproduced from config + seed + strategy.
- The browser and headless modes drift into separate simulation implementations.
- Metrics that are only live aggregates, with no export for comparison.
- Allocation API that only supports one-job-at-a-time greedy choices.

## 5. Constraints

- Local-first. Next.js server + browser + local Python process.
- Node.js 20+, Python 3.10+.
- Next.js App Router, React, TypeScript, React Three Fiber, Drei, Three.js.
- Python sidecar uses the **standard library only** (no pip install required) to keep setup friction near zero.
- npm as package manager; Vitest for TS tests; pytest for Python.
- Default dev laptop target: 30 fps at 2,000 robots; degraded gracefully below that.

## 6. System overview

```
┌─────────────────────────── browser ───────────────────────────┐
│ Next.js/React HUD (layout A)                                  │
│   │ commands (run/pause/step/speed/select allocator)          │
│   ▼                                                           │
│ Web Worker: simulation core (pure TS)                         │
│   │ snapshots @20 Hz (transferable typed arrays)              │
│   ▼                                                           │
│ React Three Fiber scene (instanced meshes, interpolated)      │
│                                                               │
│ Allocator client ──HTTP──► Python strategy service            │
└───────────────────────────────────────────────────────────────┘
                                   ▲
Headless CLI (Node) ── same core ──┘  (spawns its own Python service)

Next.js Node runtime auto-starts the Python sidecar (instrumentation.ts).
```

Key rule: **the simulation core owns the truth, the view only renders snapshots.** The core has no Three.js, DOM, or React imports and runs unchanged in a Web Worker and in Node.

## 7. Simulation model

### 7.1 World

- Rectangular grid, default **100×100**, configurable.
- Cells are traversable. Pods sit in cells but do not block robot movement (robots travel above).
- Each cell holds at most one robot.
- Coordinates are 0-based `(x, y)`. Stations sit outside the perimeter; each station config lists one or more **dock cells** inside the grid at the perimeter edge. Dock cells are ordinary traversable cells with single-robot occupancy and may be used for passing as well as delivery.
- Each station has:
  - a queue capacity (default 8 pods), counting pods waiting **and** the pod in service,
  - a service time (default 20 s),
  - an abstract pod queue (queued pods do not occupy grid cells).
- **Handoff:** a loaded robot arrives at a free dock cell. If the station queue has room, it deposits the pod immediately and becomes idle at that cell; the trip job completes at deposit. If the queue is full, the robot waits at or near the dock (state `at_station`, not assignable) until a slot opens. Multiple docks allow parallel handoffs.
- Service: a queued pod waits, is served for `serviceTimeMs`, then is absorbed; the slot frees. A replacement pod enters a free storage cell after a short replenishment delay so inventory stays roughly constant.

### 7.2 Movement and traffic

- Four-directional, one cell per movement tick. Movement tick default 100 ms sim time (10 Hz).
- Robots may wait in place. Waiting is a first-class action, not a failure.
- Paths are computed with A* over the static grid, with congestion-sensitive costs from current occupancy and short-horizon reservations.
- Each tick, robots propose their next cell; conflicts are resolved by priority (carrying robot > empty robot, then job age, then stable robot ID). Losers wait.
- Robots blocked for N ticks replan. Waiting cycles are detected; the lowest-priority participant yields to a side cell or backoff target. Deadlock events and blocked time are counted as metrics.
- A path has two legs: empty travel to the pod cell, then loaded travel to the station dock.
- This is explicitly **best-effort traffic**, not a formally deadlock-free MAPF solver.

### 7.3 Jobs and orders

- **Job** = one pod→station trip. Fields: id, order id, pod, pickup cell, candidate stations, priority, dependencies.
- **Order** = DAG of jobs. v1 generator emits:
  - one independent trip job per order line (trip jobs run in parallel),
  - an implicit **packing join** that waits for all the order's trips.
- The core supports arbitrary job dependencies (`dependsOn`) even though v1 generation is limited to this shape.
- A trip job completes when its pod is deposited at a dock, not when station service finishes.
- Packing starts when all of the order's pods have finished station service (been absorbed); it takes `packingTimeMs` at the order's station, needs no robot, and consumes no station queue capacity. It is virtual: multiple orders may pack concurrently. Order completion time ends when packing finishes.
- The packing join is never exposed to the allocator; only trip jobs are assignable.
- **Station choice is frozen per order (design call).** The first accepted assignment for an order fixes its station; later trips in that order see only that station as a candidate. Rationale: pods of one order must be packed together, and it keeps the allocator's station decision meaningful without allowing physically incoherent splits. This can be relaxed later.

### 7.4 Allocation loop

- Runs every **allocation interval** of sim time (default 1 s), configurable.
- Observation contains:
  - sim time and allocation sequence number,
  - all robots: id, cell, status (`idle`, `moving_empty`, `moving_loaded`, `waiting`, `at_station`), battery,
  - all ready jobs: id, order id, pod id, pickup cell, candidate stations, priority, dependency info,
  - all stations: id, dock cell, queue length, capacity, service time, busy state.
- Allocator returns zero or more assignments: `{jobId, robotId, stationId}`.
- Validation is **sequential in the order assignments are returned**. Each assignment must have a ready job, an idle robot, no duplicate job or robot in the batch, and a station among the job's current candidates. Invalid entries are rejected individually and counted; accepted entries apply together at the end of the tick.
- If two trips of the same order are returned with different stations, the first accepted assignment freezes the order's station; conflicting later entries are rejected because that order's candidates collapse to the frozen station. Strategies should use one station per order.
- Unassigned ready jobs stay queued for the next tick.
- Built-in FCFS:
  - jobs ordered by arrival (oldest first),
  - nearest idle robot by Manhattan distance to the pickup,
  - station with the shortest estimated travel plus queue penalty.
  - FCFS is the baseline for comparisons and the fallback when Python is unavailable.

### 7.5 Metrics

Cumulative and windowed, exported by headless mode and shown live:

- **Throughput:** completed orders per simulated hour (cumulative and rolling window).
- **Order completion time:** mean, p50, p90, p95, p99, max.
- **Robot utilisation:** fraction of robot-time in non-idle states; breakdown by state, including blocked/waiting.
- Supporting: jobs completed/pending, station queue length over time, station busy fraction, deadlock events, rejected assignments.
- Time series sampled at 1 s sim time for CSV export.

### 7.6 Determinism

- Core has no wall-clock or `Math.random`; a seeded PRNG is used for order generation and tie-breaks.
- Iteration order over robots/jobs/stations is stable.
- Same config + seed + deterministic strategy ⇒ identical metrics.
- Strategy statefulness means determinism is only as good as the strategy; the runner records config, seed, strategy name, and code/manifest hash.

### 7.7 Allocation timing and performance model

- Sim time advances only in movement ticks.
- At each allocation boundary the simulation **pauses advancing sim time** until the allocator responds or the wall-clock timeout expires. Rendering continues; the scene holds or interpolates.
- Requests carry an allocation sequence number. Only the response for the current sequence is accepted; responses arriving after timeout are discarded. On timeout/error, the configured fallback (default FCFS) applies for that boundary.
- Because no sim time passes during the call, results do not depend on machine speed or call latency; determinism holds. A slow allocator slows the run, not the sim's internal consistency.
- The speed multiplier sets the target rate of movement ticks per wall second (`tickHz × speed`). Ticks are never skipped or merged. If the machine cannot keep up, sim time falls behind wall clock and the HUD reports effective speed/lag.
- Performance targets therefore split: rendering must sustain ≥30 fps; the simulation must maintain 1× on the default scenario, and above 1× is best-effort.

## 8. Python strategy interface

### 8.1 Authoring shape

```
python/
  hive_sim/
    server.py          # stdlib HTTP server, session lifecycle, auto-start
    protocol.py        # observation/assignment types, JSON helpers
    runner.py          # strategy loading and validation
  strategies/
    fcfs_reference.py  # example mirror of the built-in FCFS
    nearest_robot.py   # simple example
    auction.py         # stateful example (carries prices across batches)
  requirements.txt     # empty/only stdlib; documents Python 3.10+
```

A strategy file:

```python
class Strategy:
    def __init__(self, config: dict | None = None):
        self.prices = {}             # arbitrary state kept across batches

    def reset(self) -> None:
        ...

    def allocate(self, observation: dict) -> list[dict]:
        # observation matches §7.4; return [{jobId, robotId, stationId}, ...]
        ...
```

### 8.2 Service and protocol

- `GET /health` → status and loaded session.
- `GET /strategies` → available strategy names/descriptions from `python/strategies/`.
- `POST /sessions` `{strategy, config}` → creates a strategy instance and keeps it alive.
- `POST /sessions/{id}/allocate` `{observation}` → `{assignments, diagnostics?}`.
- `POST /sessions/{id}/select` `{strategy}` → instantiate a new strategy for hot-swap, keeping the run.
- `POST /sessions/{id}/reset`, `DELETE /sessions/{id}`.
- A single sim calls sequentially; the server serialises calls with a lock.
- Binds `127.0.0.1`, allows localhost CORS, and can accept an ephemeral port. The parent reads the chosen port from a startup handshake line on stdout.

### 8.3 Auto-start and failure handling

- Next.js starts the sidecar once in `instrumentation.ts` (Node runtime), guarded against dev re-registration.
- Headless CLI starts its own sidecar.
- The browser discovers the sidecar URL via an API route.
- Default allocation timeout: 2 s wall clock. On timeout/error, the sim falls back to built-in FCFS for that tick by default (configurable `wait` mode), logs a warning, and keeps running. The HUD shows Python/service status.
- If Python is absent, built-in FCFS runs; strategy dropdown marks Python strategies unavailable.

## 9. Live 3D view (layout A)

Full-bleed hive with floating glass panels:

- **Top bar:** hive/scenario name, active allocator, sim clock.
- **Top-left metrics panel:** throughput, orders done, p50/p95 completion, utilisation, sparkline.
- **Top-right inspector:** clicked robot (state, battery, job, trip progress) or station (queue, capacity, service state).
- **Bottom-centre dock:** play/pause, step, speed (0.25×–16×), built-in/Python allocator selector, state legend.
- **Scene:** instanced robots coloured by state (idle, assigned/empty travel, carrying, blocked), instanced pods, grid floor, stations. Orbit camera (Drei). Click-to-select via raycast on instanced meshes.
- **Rendering:** instanced meshes only; no React component per robot. Snapshots arrive at 20 Hz; rendering interpolates between ticks. HUD updates at a lower rate (~5 Hz) so React never rerenders per frame.
- **Run controls:** restart scenario, load another config from `configs/`, hot-swap allocator (new strategy instance, same world).
- **Perf HUD:** optional FPS/robot-count/snapshot stats, toggleable.

## 10. Headless mode

```
npm run sim -- --config configs/default.json --strategy auction --until 24h --seed 42 --out results/
```

- Spawns the Python sidecar, runs the same core at fixed timestep as fast as possible, writes:
  - `summary.json` — metrics, scenario config, seed, strategy, wall-clock duration, sim duration;
  - `metrics.csv` — 1 s time series;
  - `config.resolved.json`.
- Prints the scorecard to stdout.
- Runs do not require a GPU, browser, or Next.js server.

## 11. Configuration

JSON, validated by a shared schema (zod). Example:

```json
{
  "grid": { "width": 100, "height": 100 },
  "robots": 2000,
  "pods": { "count": 6000, "replenishDelayMs": 5000 },
  "stations": [
    { "id": "S-1", "docks": [[0, 25], [0, 26]], "queueCapacity": 8, "serviceTimeMs": 20000 },
    { "id": "S-2", "docks": [[99, 50], [99, 51]], "queueCapacity": 8, "serviceTimeMs": 20000 },
    { "id": "S-3", "docks": [[0, 75], [0, 76]], "queueCapacity": 8, "serviceTimeMs": 20000 }
  ],
  "orders": {
    "arrivalRatePerHour": 1600,
    "linesPerOrder": { "min": 1, "max": 6 },
    "packingTimeMs": 30000
  },
  "allocation": { "intervalMs": 1000, "strategy": "fcfs", "timeoutMs": 2000, "onFailure": "fallback-fcfs" },
  "movement": { "tickMs": 100 },
  "seed": 42
}
```

CLI flags override config values. Configs live in `configs/` and are listed in the web UI.

## 12. Architecture and repo layout

Single Next.js app with a pure-TS simulation package inside `src/sim` (no monorepo complexity in v1).

```
src/
  app/                    # App Router pages, API routes (/api/sim-config, /api/configs)
  components/hive/        # R3F canvas, instanced renderers, camera, picking
  components/hud/         # layout A panels, dock, inspector, metrics
  sim/                    # pure TS core (no DOM/Three/React)
    config.ts             # zod schema + defaults
    world.ts              # grid, robots, pods, stations
    movement.ts           # A*, reservations, conflict resolution, deadlock recovery
    orders.ts             # generator, DAG, packing join
    allocation.ts         # tick loop, validation, built-in FCFS
    metrics.ts            # counters, percentiles, time series
    rng.ts                # seeded PRNG
    index.ts              # public Simulation facade
  worker/sim.worker.ts    # worker protocol, snapshot encoding
  lib/                    # snapshot types, allocator client, stores
scripts/run-headless.ts
python/                   # sidecar + strategies (see §8)
configs/
tests/                    # vitest
docs/superpowers/specs/   # this document
```

- The worker owns one `Simulation` instance. Commands and snapshots use a small typed protocol.
- Snapshot buffers: robot cell x/y, state, carrying flag, battery; pod visibility/positions; station queue lengths; aggregate metrics. Transferables, double-buffered.
- Allocator client: built-in TS strategy in the worker, or HTTP call to Python. The worker pauses sim-time advancement at allocation boundaries (per §7.7) while continuing to publish snapshots, so rendering never stalls.
- The Next.js API routes only serve discovery/configuration; they do not simulate.

## 13. Testing and verification

- **Unit (Vitest):** config validation, DAG readiness, movement reservation/conflict resolution, allocation validation (bad robot/job/station/duplicates), FCFS baseline, metrics math, seeded generator reproducibility.
- **Determinism:** run a short scenario twice with the same seed and built-in FCFS; assert identical summaries.
- **Python (pytest):** protocol round-trip, strategy loading errors, state persistence across calls, hot-swap.
- **Headless smoke:** default config for a short horizon; assert summary fields and CSV rows.
- **Performance benchmark:** scripted 2,000-robot headless hour and browser manual checklist at 2,000 robots; record wall-clock and FPS. Not a hard CI gate in v1.
- **Browser smoke:** manual checklist for load/run/pause/step/inspect/hot-swap; optional Playwright later.

## 14. Success criteria

- 2,000 robots on 100×100 render at ≥30 fps in Chrome on a typical dev laptop while the simulation advances at 1×.
- On the default scenario the sim advances at 1× wall clock; above 1× is best-effort with lag reported in the HUD. Ticks are never skipped.
- A 24 h scenario completes headless in less than 24 h wall clock (target comfortably faster; benchmark recorded).
- Adding a new Python strategy requires only one file in `python/strategies/`.
- FCFS runs end-to-end with Python stopped.
- Switching allocator mid-run takes effect on the next allocation tick.
- Identical config + seed + strategy produce identical metrics.
- Headless summary reports throughput, completion percentiles, and utilisation.

## 15. Milestones (order for planning, not detailed steps)

1. Simulation core + config + seeded generator + built-in FCFS + unit tests.
2. Headless runner + metrics export.
3. Python sidecar, protocol, example strategies, auto-start, pytest.
4. Web Worker integration + snapshot protocol.
5. R3F scene at scale (instancing, interpolation) + layout A HUD + controls/inspection.
6. Performance tuning, benchmark, docs, example scenarios.

## 16. Decisions left to the builder

- Exact A* cost function, congestion penalty, reservation horizon, replan threshold, and deadlock-recovery heuristic.
- Exact priority ordering within movement conflict resolution (beyond carrying > empty) and its tuning.
- Cell/world scale and visual proportions for rendering.
- Snapshot packing format and HUD update cadence.
- Visual styling details within layout A (colours, typography, panel spacing, sparkline rendering).
- Exact percentile/utilisation formulas and rolling-window size.
- Pod replenishment placement rule and default scenario numbers.
- Test file organisation and fixture strategy.
- Python HTTP server details (threading model, diagnostics payload shape) within the stdlib constraint.
- Whether a browser smoke test via Playwright is worth adding in v1.
