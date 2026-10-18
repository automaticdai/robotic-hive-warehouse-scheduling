import pytest

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
