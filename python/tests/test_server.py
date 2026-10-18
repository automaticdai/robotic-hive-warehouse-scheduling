import json
import threading
import urllib.error
import urllib.request

import pytest

from hive_sim.server import create_server


def start_test_server():
    server = create_server(port=0, strategies_dir="strategies")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def post(url, payload):
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


def test_session_lifecycle():
    server, base = start_test_server()
    try:
        health = json.loads(urllib.request.urlopen(f"{base}/health").read())
        assert health["status"] == "ok"
        created = post(f"{base}/sessions", {"strategy": "auction", "config": {}})
        session_id = created["sessionId"]
        result = post(f"{base}/sessions/{session_id}/allocate", {
            "simTimeMs": 0, "allocationSeq": 0, "robots": [], "jobs": [], "stations": [],
        })
        assert result["diagnostics"]["calls"] == 1
        selected = post(f"{base}/sessions/{session_id}/select", {"strategy": "fcfs_reference"})
        assert selected["strategy"] == "fcfs_reference"
    finally:
        server.shutdown()


def test_health_session_is_null_then_latest_created_session():
    server, base = start_test_server()
    try:
        health = json.loads(urllib.request.urlopen(f"{base}/health").read())
        assert health["session"] is None
        first = post(f"{base}/sessions", {"strategy": "auction", "config": {}})
        assert json.loads(urllib.request.urlopen(f"{base}/health").read())["session"] == first["sessionId"]
        second = post(f"{base}/sessions", {"strategy": "fcfs_reference", "config": {}})
        assert json.loads(urllib.request.urlopen(f"{base}/health").read())["session"] == second["sessionId"]
    finally:
        server.shutdown()


def test_delete_session_removes_it():
    server, base = start_test_server()
    try:
        created = post(f"{base}/sessions", {"strategy": "auction", "config": {}})
        request = urllib.request.Request(f"{base}/sessions/{created['sessionId']}", method="DELETE")
        with urllib.request.urlopen(request) as response:
            assert json.loads(response.read()) == {"status": "ok"}
        with pytest.raises(urllib.error.HTTPError) as info:
            post(f"{base}/sessions/{created['sessionId']}/allocate", {})
        assert info.value.code == 404
        assert json.loads(urllib.request.urlopen(f"{base}/health").read())["session"] is None
    finally:
        server.shutdown()


def test_unknown_session_returns_404():
    server, base = start_test_server()
    try:
        with pytest.raises(urllib.error.HTTPError) as info:
            post(f"{base}/sessions/not-a-session/allocate", {})
        assert info.value.code == 404
        assert "error" in json.loads(info.value.read())
        with pytest.raises(urllib.error.HTTPError) as info:
            post(f"{base}/sessions/not-a-session/select", {"strategy": "auction"})
        assert info.value.code == 404
    finally:
        server.shutdown()


def test_unknown_strategy_returns_400():
    server, base = start_test_server()
    try:
        with pytest.raises(urllib.error.HTTPError) as info:
            post(f"{base}/sessions", {"strategy": "not_a_strategy", "config": {}})
        assert info.value.code == 400
        assert "error" in json.loads(info.value.read())
        created = post(f"{base}/sessions", {"strategy": "auction", "config": {}})
        with pytest.raises(urllib.error.HTTPError) as info:
            post(f"{base}/sessions/{created['sessionId']}/select", {"strategy": "not_a_strategy"})
        assert info.value.code == 400
    finally:
        server.shutdown()


def test_options_preflight_cors():
    server, base = start_test_server()
    try:
        request = urllib.request.Request(
            f"{base}/sessions",
            method="OPTIONS",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type",
            },
        )
        with urllib.request.urlopen(request) as response:
            assert response.status == 204
            assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:3000"
            assert "POST" in response.headers["Access-Control-Allow-Methods"]
            assert "DELETE" in response.headers["Access-Control-Allow-Methods"]
            assert response.headers["Access-Control-Allow-Headers"] == "Content-Type"

        foreign = urllib.request.Request(f"{base}/health", headers={"Origin": "http://example.com"})
        with urllib.request.urlopen(foreign) as response:
            assert response.headers.get("Access-Control-Allow-Origin") is None
    finally:
        server.shutdown()


def test_strategy_exception_returns_500(tmp_path):
    (tmp_path / "boom.py").write_text(
        "class Strategy:\n"
        "    def __init__(self, config=None):\n"
        "        pass\n"
        "    def reset(self):\n"
        "        pass\n"
        "    def allocate(self, observation):\n"
        "        raise RuntimeError('boom')\n"
    )
    server = create_server(port=0, strategies_dir=str(tmp_path))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        created = post(f"{base}/sessions", {"strategy": "boom", "config": {}})
        with pytest.raises(urllib.error.HTTPError) as info:
            post(
                f"{base}/sessions/{created['sessionId']}/allocate",
                {"simTimeMs": 0, "allocationSeq": 1, "robots": [], "jobs": [], "stations": []},
            )
        assert info.value.code == 500
        assert json.loads(info.value.read())["error"] == "boom"
    finally:
        server.shutdown()


def test_strategies_listing():
    server, base = start_test_server()
    try:
        data = json.loads(urllib.request.urlopen(f"{base}/strategies").read())
        names = [strategy["name"] for strategy in data["strategies"]]
        assert names == sorted(names)
        assert "auction" in names
        assert "fcfs_reference" in names
        assert "nearest_robot" in names
        assert "__init__" not in names
        auction = next(strategy for strategy in data["strategies"] if strategy["name"] == "auction")
        assert auction["description"]
    finally:
        server.shutdown()


def test_invalid_json_returns_400_with_cors():
    server, base = start_test_server()
    try:
        request = urllib.request.Request(
            f"{base}/sessions",
            data=b"{not json",
            headers={"Content-Type": "application/json", "Origin": "http://127.0.0.1:3000"},
            method="POST",
        )
        with pytest.raises(urllib.error.HTTPError) as info:
            urllib.request.urlopen(request)
        assert info.value.code == 400
        assert info.value.headers["Access-Control-Allow-Origin"] == "http://127.0.0.1:3000"
        assert "error" in json.loads(info.value.read())
    finally:
        server.shutdown()
