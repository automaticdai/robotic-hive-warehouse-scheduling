"""Wire protocol helpers for the strategy sidecar.

The sidecar exchanges plain JSON dictionaries with the TypeScript host. These
helpers validate strategy output without adding a runtime dependency.
"""

from __future__ import annotations

from typing import Any

_ASSIGNMENT_FIELDS = ("jobId", "robotId", "stationId")


def parse_assignments(value: Any) -> list[dict[str, str]]:
    """Validate and normalize a strategy's assignment list.

    Every entry must be a dict containing string ``jobId``, ``robotId`` and
    ``stationId`` values. Extra keys are dropped so the host receives exactly
    the shape produced by the built-in allocator.
    """
    if not isinstance(value, list):
        raise ValueError("assignments must be a list")

    assignments: list[dict[str, str]] = []
    for index, entry in enumerate(value):
        if not isinstance(entry, dict):
            raise ValueError(f"assignment {index} must be an object")
        if set(entry) != set(_ASSIGNMENT_FIELDS):
            raise ValueError(
                f"assignment {index} must contain exactly {', '.join(_ASSIGNMENT_FIELDS)}"
            )
        normalized: dict[str, str] = {}
        for field in _ASSIGNMENT_FIELDS:
            if field not in entry:
                raise ValueError(f"assignment {index} is missing {field}")
            item = entry[field]
            if not isinstance(item, str):
                raise ValueError(f"assignment {index} field {field} must be a string")
            normalized[field] = item
        assignments.append(normalized)
    return assignments


def observation_summary(observation: Any) -> dict[str, int]:
    """Return the number of robots, jobs and stations in an observation."""
    if not isinstance(observation, dict):
        raise ValueError("observation must be an object")
    return {
        "robots": len(observation.get("robots") or []),
        "jobs": len(observation.get("jobs") or []),
        "stations": len(observation.get("stations") or []),
    }
