"""Empty auction scaffold that records allocation calls."""

from __future__ import annotations

from typing import Any


class Strategy:
    """Placeholder for a user-written auction strategy.

    The host accepts an empty assignment list, so this module is a runnable
    starting point: fill in ``allocate`` with a real auction implementation.
    """

    def __init__(self, config: dict | None = None) -> None:
        self.config = config or {}
        self.calls = 0

    def reset(self) -> None:
        self.calls = 0

    def allocate(self, observation: dict[str, Any]) -> dict[str, Any]:
        self.calls += 1
        return {"assignments": [], "diagnostics": {"calls": self.calls}}
