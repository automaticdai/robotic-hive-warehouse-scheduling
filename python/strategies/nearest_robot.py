"""Greedy strategy choosing the nearest idle robot and nearest station dock."""

from __future__ import annotations

from typing import Any


def _manhattan(a: dict[str, int], b: dict[str, int]) -> int:
    return abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])


def _station_distance(pickup: dict[str, int], station: dict[str, Any]) -> int:
    docks = station.get("docks") or []
    if not docks:
        return 0
    return min(_manhattan(pickup, dock) for dock in docks)


class Strategy:
    """Assign each ready job the closest idle robot and closest candidate station."""

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
                key=lambda candidate: (_station_distance(job["pickup"], stations[candidate]), candidate),
            )
            robots.remove(robot)
            assignments.append(
                {"jobId": job["id"], "robotId": robot["id"], "stationId": station_id}
            )

        return {"assignments": assignments, "diagnostics": {"calls": self.calls}}
