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
