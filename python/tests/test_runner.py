import pytest

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


def test_missing_strategy_file_raises_value_error():
    with pytest.raises(ValueError):
        StrategySession("does_not_exist", strategies_dir="strategies")


def test_missing_non_default_relative_dir_raises_file_not_found():
    with pytest.raises(FileNotFoundError):
        StrategySession("auction", strategies_dir="definitely_missing_strategies_dir")


def test_dataclass_strategy_module_loads(tmp_path):
    (tmp_path / "dataclass_strategy.py").write_text(
        "from __future__ import annotations\n"
        "\n"
        "from dataclasses import dataclass\n"
        "\n"
        "\n"
        "@dataclass\n"
        "class Strategy:\n"
        "    config: dict | None = None\n"
        "    calls: int = 0\n"
        "\n"
        "    def reset(self) -> None:\n"
        "        self.calls = 0\n"
        "\n"
        "    def allocate(self, observation: dict) -> dict:\n"
        "        self.calls += 1\n"
        "        return {'assignments': [], 'diagnostics': {'calls': self.calls}}\n"
    )

    session = StrategySession("dataclass_strategy", strategies_dir=str(tmp_path))
    result = session.allocate({"simTimeMs": 0, "allocationSeq": 0, "robots": [], "jobs": [], "stations": []})
    assert result["diagnostics"]["calls"] == 1
