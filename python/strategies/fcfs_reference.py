"""First-come-first-served reference strategy mirroring the built-in allocator."""

from __future__ import annotations

from typing import Any

QUEUE_PENALTY = 5


def _manhattan(a: dict[str, int], b: dict[str, int]) -> int:
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])


def _pickup_to_station(pickup: dict[str, int], station: dict[str, Any]) -> int:
    docks = station.get("docks") or []
    if not docks:
        return 0
    return min(_manhattan(pickup, dock) for dock in docks)


def _station_key(pickup: dict[str, int], station: dict[str, Any], queue_penalty: int) -> tuple[int, str]:
    cost = _pickup_to_station(pickup, station) + queue_penalty * station.get("queueLength", 0)
    return cost, station["id"]


class Strategy:
    """Serve ready jobs in creation order using the nearest idle robot."""

    def __init__(self, config: dict | None = None) -> None:
        self.config = config or {}
        self.calls = 0

    def reset(self) -> None:
        self.calls = 0

    def allocate(self, observation: dict[str, Any]) -> dict[str, Any]:
        self.calls += 1

        robots = sorted(
            (
                robot
                for robot in observation.get("robots", [])
                if robot.get("status") == "idle" and robot.get("jobId") is None
            ),
            key=lambda robot: robot["id"],
        )
        stations = {station["id"]: station for station in observation.get("stations", [])}
        jobs = sorted(
            observation.get("jobs", []),
            key=lambda job: (job["createdAtMs"], job["id"]),
        )

        assignments: list[dict[str, str]] = []
        for job in jobs:
            if not robots:
                break

            robot = min(
                robots,
                key=lambda candidate: (_manhattan(candidate["cell"], job["pickup"]), candidate["id"]),
            )
            candidate_ids = [station_id for station_id in job.get("candidateStations", []) if station_id in stations]
            if not candidate_ids:
                continue

            station_id = min(
                candidate_ids,
                key=lambda candidate: _station_key(job["pickup"], stations[candidate], QUEUE_PENALTY),
            )
            robots.remove(robot)
            assignments.append(
                {"jobId": job["id"], "robotId": robot["id"], "stationId": station_id}
            )

        return {"assignments": assignments, "diagnostics": {"calls": self.calls}}
