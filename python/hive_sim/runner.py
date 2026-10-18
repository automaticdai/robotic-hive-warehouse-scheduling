"""Load user strategy modules and serialize calls behind a per-session lock."""

from __future__ import annotations

import importlib.util
import sys
import threading
import uuid
from pathlib import Path
from typing import Any

from .protocol import parse_assignments

# ``server.py`` lives in ``python/hive_sim``; strategy files live next to it.
DEFAULT_STRATEGIES_DIR = Path(__file__).resolve().parent.parent / "strategies"
_DEFAULT_RELATIVE_NAME = "strategies"


def resolve_strategies_dir(strategies_dir: str | Path) -> Path:
    """Resolve a strategies directory against the current working directory.

    The bundled tests pass the literal relative path ``strategies``; when they
    run from the repository root that directory does not exist, so only that
    literal value falls back to the package-relative default. Any other missing
    path (for example a misspelled ``--strategies-dir stratgies``) raises
    ``FileNotFoundError`` instead of silently loading the bundled strategies.
    """
    raw = Path(strategies_dir)
    path = raw if raw.is_absolute() else Path.cwd() / raw
    if path.is_dir():
        return path
    if str(strategies_dir) == _DEFAULT_RELATIVE_NAME and DEFAULT_STRATEGIES_DIR.is_dir():
        return DEFAULT_STRATEGIES_DIR
    raise FileNotFoundError(f"Strategies directory not found: {strategies_dir}")


class StrategySession:
    """One live strategy instance and the lock guarding its stateful calls."""

    def __init__(
        self,
        strategy: str,
        strategies_dir: str | Path = DEFAULT_STRATEGIES_DIR,
        config: dict[str, Any] | None = None,
    ) -> None:
        self._lock = threading.Lock()
        self._strategies_dir = resolve_strategies_dir(strategies_dir)
        self._config = config
        self.strategy_name = strategy
        self._strategy = self._load(strategy)

    def _load(self, name: str) -> Any:
        if (
            not isinstance(name, str)
            or not name
            or name.startswith("_")
            or "/" in name
            or "\\" in name
        ):
            raise ValueError(f"Unknown strategy: {name!r}")

        path = self._strategies_dir / f"{name}.py"
        if not path.is_file():
            raise ValueError(f"Unknown strategy: {name}")

        module_name = f"hive_sim_strategy_{name}_{uuid.uuid4().hex}"
        spec = importlib.util.spec_from_file_location(module_name, path)
        if spec is None or spec.loader is None:
            raise ValueError(f"Unable to load strategy: {name}")
        module = importlib.util.module_from_spec(spec)
        # dataclasses (and other runtime introspection) look modules up here.
        sys.modules[module_name] = module
        try:
            spec.loader.exec_module(module)
        except Exception:
            sys.modules.pop(module_name, None)
            raise

        strategy_class = getattr(module, "Strategy", None)
        if not callable(strategy_class):
            raise ValueError(f"Strategy {name!r} does not define a Strategy class")
        return strategy_class(self._config)

    def allocate(self, observation: dict[str, Any]) -> dict[str, Any]:
        """Run one allocation under the session lock and validate its output."""
        with self._lock:
            result = self._strategy.allocate(observation)
            if not isinstance(result, dict):
                raise ValueError("Strategy allocate() must return an object")
            assignments = parse_assignments(result.get("assignments", []))
            diagnostics = result.get("diagnostics", {})
            if diagnostics is None:
                diagnostics = {}
            if not isinstance(diagnostics, dict):
                raise ValueError("Strategy diagnostics must be an object")
            return {"assignments": assignments, "diagnostics": diagnostics}

    def select(self, name: str) -> str:
        """Load a fresh strategy module/instance for this session."""
        with self._lock:
            strategy = self._load(name)
            self._strategy = strategy
            self.strategy_name = name
        return name

    def reset(self) -> None:
        with self._lock:
            self._strategy.reset()
