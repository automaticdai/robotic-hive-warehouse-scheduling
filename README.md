# Robotic Hive Warehouse Simulator

A local research harness for task allocation in an Ocado-style hive warehouse. Orders
arrive continuously; an allocator chooses which idle robot takes each pod-to-station trip
and which station it serves. The consequences — travel, congestion, station queueing and
packing — play out in a deterministic simulation that runs both in a live 3D browser view
and headlessly for comparable metrics.

The same pure-TypeScript simulation core drives both modes, and custom allocation policies
are stateful Python classes loaded by an auto-started local sidecar. FCFS is the built-in
baseline and works with no Python installed.

## Prerequisites

- **Node.js 20+** (developed and tested on Node 22).
- **Python 3.10 or newer (tested on 3.12)** for Python strategies and the sidecar. The sidecar uses the Python
  standard library only, so no runtime packages are required.
- A modern browser with WebGL for the live view.

The default scenario targets 2,000 robots on a 100×100 grid.

## Install

```bash
npm install
```

Python runtime dependencies are empty. To run the Python test suite instead:

```bash
python3 -m pip install -r python/requirements-dev.txt   # pytest only
```

## Quick start: live mode

```bash
npm run dev
```

Open <http://localhost:3000>. The Next.js Node runtime auto-starts the Python sidecar from
`src/instrumentation.ts`; the top bar reports `Python online` or
`Python offline — FCFS only`. If Python cannot start, the built-in FCFS allocator keeps
working. Set `HIVE_PYTHON` to a different interpreter path if `python3` is not on `PATH`.

A boot failure (for example `/api/sim-config` failing) and any allocator/strategy failure
are shown in an alert badge in the top bar, even before a scenario has loaded. An
allocation that times out or returns an error falls back to FCFS per
`allocation.onFailure`; the error clears as soon as the next allocation succeeds, and a
failed init or strategy hot-swap stays visible until a later init/select succeeds. Failure
and recovery are also logged once per allocator to the browser console rather than once
per allocation. The sidecar discovery endpoint revalidates each request, so a sidecar that
dies or recovers is reflected without a page reload; a `PythonAllocator` also recreates
its session once if the sidecar reports that the cached session is unknown (404).

### Layout and controls

The UI uses layout A — a full-bleed hive with floating glass panels:

- **Top bar:** scenario name, active allocator, Python status, simulation clock.
- **Top-left metrics:** throughput, orders completed, completion p50/p95, utilisation,
  pending jobs, and a throughput sparkline.
- **Top-right inspector:** click a robot to see its state, battery, job, order, assigned
  station, path progress and carrying flag; click a station to see queue length/capacity,
  busy state and remaining service time.
- **Bottom dock:** Play/Pause, Step, Restart, speed selector (0.25×, 0.5×, 1×, 2×, 4×,
  8×, 16×), measured achieved speed, algorithm selector, scenario selector, and the
  robot-state legend.
- **Scene:** instanced robots and pods, grid floor and station meshes, with orbit/zoom
  camera controls. The algorithm selector requests a hot-swap on the next allocation
  tick, keeping the same world; the label changes only after the worker acknowledges the
  active strategy, so a rejected strategy leaves the previous label in place and shows
  the error. Choosing a scenario restarts the simulation with that config, and **Restart**
  reruns the currently active config without reselecting it.

## Headless runs

```bash
npm run sim -- --config configs/default.json --strategy builtin:fcfs --until 24h
```

Flags:

| Flag | Required | Description |
| --- | --- | --- |
| `--config <path>` | yes | Scenario JSON, normally under `configs/`. |
| `--until <duration>` | yes | Positive integer with an `ms`, `s`, `m`, or `h` suffix. |
| `--strategy <id>` | no | `builtin:fcfs` (default) or `python:<module>`. |
| `--seed <int>` | no | Overrides the config seed. |
| `--out <dir>` | no | Output directory; defaults to a fresh `results/<timestamp>`. |

Unknown flags, missing values, and invalid durations or seeds exit with code 1. A Python
strategy starts its own sidecar for the run; if it is unavailable, the configured
`allocation.onFailure` policy applies (`fallback-fcfs` by default).

Each run writes three files to the output directory:

- **`summary.json`** — resolved config, seed, strategy id, strategy digest, simulated
  duration, wall time, and the full `MetricsSummary`. It also records allocator fallback
  accounting: `effectiveStrategy`, `allocationAttempts`, `allocatorFailures`,
  `fallbackAllocations`, and `usedFallback`. `strategy` remains the requested id;
  `effectiveStrategy` is `fallback-fcfs` when any allocation fell back, so a run in which
  a Python strategy never answered is never presented as a pure Python result.
  Headless runs print a warning on the first allocator failure and a prominent summary
  warning at the end when fallback was used; they do not change the exit code, because
  `fallback-fcfs` is configured behavior.
- **`metrics.csv`** — time series sampled every 1 s of simulated time with columns
  `simTimeMs,ordersCompleted,jobsCompleted,throughputPerHour,utilisation,pendingJobs,avgQueueLength`.
- **`config.resolved.json`** — the config after defaults have been applied.

The scorecard (orders, throughput, completion p50/p95, utilisation, sim/wall ratio) is
printed to stdout.

### Benchmark

```bash
npm run benchmark -- --hours 1
```

The benchmark runs `runHeadless` twice at the same simulated duration: the first run warms
up the process and is discarded, the second is measured. Outputs go to distinct directories
under the git-ignored `results/` tree. It measures the ratio
`simHoursPerWallHour = simDurationMs / wallTimeMs`, prints machine, config, duration, wall
time, ratio and key metrics, writes [`docs/benchmarks.md`](docs/benchmarks.md), and exits
non-zero when the measured ratio is below 1.0. `--hours` defaults to 1; unknown or invalid
flags exit with code 1.

## Writing a Python strategy

Add **one file** under `python/strategies/`. The file name is the module name; the
qualified strategy id is `python:<module>`, for example `python:nearest_robot` for
`python/strategies/nearest_robot.py`.

The strategy contract:

- The module name must match `[A-Za-z][A-Za-z0-9_]*` (validated in
  `src/lib/allocator.ts`); `python/hive_sim/runner.py` also rejects an empty name, a
  leading `_`, or path separators.
- The module must define a callable `Strategy` class. It is instantiated once per session
  as `Strategy(config)`, where `config` is the object sent in the `POST /sessions` body
  (the bundled TypeScript client sends `{}`).
- `Strategy.allocate(observation)` must return a dict with an `assignments` list and may
  include a `diagnostics` object. Every assignment must contain exactly the string fields
  `jobId`, `robotId` and `stationId`; extra keys are rejected.
- `Strategy.reset()` is required by the session reset endpoint and should clear any state.
- Strategy state persists across allocation calls within a session. Hot-swapping with
  `select` loads a fresh module instance.
- The first line of the module docstring is exposed as the strategy description by the
  sidecar.

Minimal stateful example — nearest idle robot and the job's first candidate station:

```python
"""Assign the nearest idle robot and the first candidate station."""

from __future__ import annotations

from typing import Any


def _distance(a: dict[str, int], b: dict[str, int]) -> int:
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])


class Strategy:
    def __init__(self, config: dict | None = None) -> None:
        self.config = config or {}
        self.calls = 0

    def reset(self) -> None:
        self.calls = 0

    def allocate(self, observation: dict[str, Any]) -> dict[str, Any]:
        self.calls += 1
        idle = [
            robot
            for robot in observation["robots"]
            if robot["status"] == "idle" and robot["jobId"] is None
        ]
        jobs = sorted(
            observation["jobs"], key=lambda job: (job["createdAtMs"], job["id"])
        )

        assignments = []
        for job in jobs:
            if not idle:
                break
            robot = min(
                idle, key=lambda candidate: (_distance(candidate["cell"], job["pickup"]), candidate["id"])
            )
            idle.remove(robot)
            assignments.append(
                {
                    "jobId": job["id"],
                    "robotId": robot["id"],
                    "stationId": job["candidateStations"][0],
                }
            )

        return {"assignments": assignments, "diagnostics": {"calls": self.calls}}
```

The observation passed to `allocate` contains:

- `simTimeMs`, `allocationSeq`.
- `robots`: `id`, `cell` (`{x, y}`), `status` (`idle`, `moving_empty`, `moving_loaded`,
  `waiting`, `at_station`), `battery`, `jobId`.
- `jobs` (ready jobs only): `id`, `orderId`, `podId`, `pickup`, `candidateStations`,
  `priority`, `createdAtMs`, `dependsOn`.
- `stations`: `id`, `queueLength`, `queueCapacity`, `serviceTimeMs`, `busy`, `docks`.

Assignments are validated sequentially: the job must be ready, the robot idle and
unassigned, the station a current candidate, and neither job nor robot may appear twice in
one batch. Once an order's first trip is accepted its station is frozen, so later jobs for
that order expose only that station as a candidate. Invalid entries are rejected and
counted; valid entries apply together at the end of the allocation tick.

### Sidecar endpoints

The sidecar binds `127.0.0.1` on an ephemeral port and prints a JSON handshake line on
stdout. All other endpoints exchange JSON:

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | `{status, session}` health and latest session id. |
| `GET /strategies` | `{strategies: [{name, description}]}` from `python/strategies/`. |
| `POST /sessions` | `{strategy, config}` → `{sessionId, strategy}`; loads a fresh instance. |
| `POST /sessions/{id}/allocate` | Raw observation object → `{assignments, diagnostics}`. |
| `POST /sessions/{id}/select` | `{strategy}` → hot-swap to a fresh module instance. |
| `POST /sessions/{id}/reset` | Calls the strategy's `reset()`. |
| `DELETE /sessions/{id}` | Drops the session. |

Calls on one session are serialised by a lock. The browser discovers the sidecar through
`/api/sim-config`, and scenario files through `/api/configs`; a slow or failing strategy is
subject to the allocation timeout and fallback policy rather than blocking the simulation.

## Metrics

Metrics are cumulative unless noted, exported in `summary.json`, and shown live:

- **Throughput** — completed orders per simulated hour:
  `ordersCompleted / (simTimeMs / 3_600_000)`. The trailing-hour window
  (`throughputWindowPerHour`) counts orders completed in the last simulated hour.
- **Completion time distribution** — order creation to packing completion, reported as
  mean, p50, p90, p95, p99 and max. Percentiles use linear interpolation over the sorted
  completed-order durations.
- **Robot utilisation** — the fraction of robot-time in non-idle states, plus a breakdown
  by `idle`, `movingEmpty`, `movingLoaded`, `waiting` and `atStation` (waiting and
  at-station time count as utilisation).
- **Rejected assignments** — cumulative count of individual assignments rejected by
  validation.
- **Deadlock events** — cumulative traffic deadlock detection/recovery events.
- **Station queue stats** — per station `busyFraction` (service time over simulated time),
  `avgQueueLength` (tick-average queue length) and `maxQueueLength`.
- **Jobs completed / pending** — deposited trips versus jobs not yet complete.

A trip job completes when the pod is deposited at a dock; the order completes after all of
its pods are serviced and the packing timer finishes.

## Determinism

- The config `seed` (default 42, overridable with `--seed`) drives order generation, pod
  replenishment placement and simulation tie-breaks through a seeded PRNG. The core never
  reads wall-clock time or `Math.random`.
- Iteration over robots, jobs and stations uses stable array/Map insertion order, and FCFS
  breaks ties by creation time and id.
- At each allocation boundary, simulated time **pauses** until the allocator responds or
  the wall-clock timeout expires. No ticks are skipped or merged, so allocator latency
  changes wall time, not simulation results. Only the response for the current allocation
  sequence is accepted; on timeout/error the configured fallback applies.
- Same config + seed + deterministic strategy produces identical metrics; the headless
  test suite asserts this. A stateful Python strategy is only as deterministic as its own
  logic. `summary.json` records the strategy id and a digest — `builtin` for the built-in
  allocator, or the SHA-256 of the Python module source.

## Performance targets

- **Headless:** faster than real time on the default scenario. The benchmark enforces a
  measured `simHoursPerWallHour >= 1.0` and exits non-zero otherwise. A 24 h scenario
  should finish comfortably inside 24 h wall time.
- **Live:** 2,000 robots at ≥30 fps while the simulation advances at 1×. This browser
  check is an outstanding manual acceptance target; it is **not** measured by the headless
  benchmark and is listed as such in [`docs/benchmarks.md`](docs/benchmarks.md).
- Ticks are never skipped or merged. Requested speed is a target rate; the HUD shows the
  requested multiplier and, separately, the measured achieved speed (simulated time
  advanced per wall time over a short window). When the achieved rate falls materially
  below the target while running, the achieved value is highlighted in amber. Paused runs
  report no achieved speed. The default allocation wall-clock timeout is 2 s, after which
  FCFS fallback applies.

## Adding a scenario

Create `configs/<name>.json`; the UI discovers every JSON file under `configs/` and lists
it in the scenario selector. All fields are validated by `src/sim/config.ts`, which also
applies defaults for omitted values. A complete explicit config is recommended — see
[`configs/default.json`](configs/default.json); headless runs write the resolved form as
`config.resolved.json` in their output directory.

Key fields: `grid {width, height}`, `robots`, `pods {count, replenishDelayMs}`,
`stations [{id, docks [[x, y], ...], queueCapacity, serviceTimeMs}]`,
`orders {arrivalRatePerHour, linesPerOrder {min, max}, packingTimeMs}`,
`allocation {intervalMs, strategy, timeoutMs, onFailure}`, `movement {tickMs}`, `seed`.

Validation rules include: positive integers for sizes and durations; `robots` no greater
than the grid cell count; `robots + pods.count` no greater than the grid cell count; at
least one station, with docks inside the grid; unique station ids and dock cells;
`linesPerOrder.min <= max`. Invalid
files are skipped by discovery with a warning, so a broken scenario does not prevent the
UI from loading.

## Architecture

```
src/sim/            Pure TypeScript core: config (zod), world, seeded RNG, order
                    generation, movement/routing, allocation validation, FCFS,
                    metrics, and the Simulation facade. No DOM, React or Three.js.
src/worker/         Web Worker that owns one Simulation; src/lib/simClient.ts and
                    snapshotSource.ts decode and interpolate typed-array snapshots
                    published every 50 ms (status at 200 ms).
src/components/hive R3F instanced scene: robots, pods, grid floor, stations, picking.
src/components/hud  Layout A panels and controls backed by the Zustand HUD store.
src/headless/       CLI parsing and the headless loop; scripts/run-headless.ts and
                    scripts/benchmark.ts are the command entry points.
python/hive_sim/    Stdlib sidecar: server.py (HTTP/session lifecycle), runner.py
                    (module loading, Strategy instantiation, locking), protocol.py
                    (assignment validation).
python/strategies/  User strategy modules; fcfs_reference.py, nearest_robot.py and
                    auction.py ship as examples.
src/server/         Sidecar spawn/probe/discovery for Next.js and headless runs.
src/app/            App Router page and read-only discovery routes (/api/sim-config,
                    /api/configs); these do not simulate.
```

The simulation core owns the truth; the browser only renders snapshots. Because the core
is free of DOM/Three/React imports, the Web Worker, the headless runner and the tests all
execute the same implementation. Allocation is a request/response boundary: the worker or
headless runner pauses simulated time, sends the full ready batch to the built-in
allocator or the Python sidecar, validates the returned assignments, and resumes.

## Tests

```bash
npm run lint
npm test
npm run build
python3 -m pytest -q python
```

Vitest covers config validation, world/movement/order logic, allocation and FCFS,
metrics, determinism, the worker protocol/client, the headless runner, the HUD and the
sidecar integration. pytest covers the Python protocol, strategy loading/state and HTTP
server.
