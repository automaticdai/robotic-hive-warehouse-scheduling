"""Standard-library HTTP server exposing strategy sessions to the TypeScript host."""

from __future__ import annotations

import argparse
import ast
import json
import signal
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .runner import DEFAULT_STRATEGIES_DIR, StrategySession, resolve_strategies_dir

_ALLOWED_METHODS = "GET, POST, DELETE, OPTIONS"
_ALLOWED_HEADERS = "Content-Type"
_LOCAL_ORIGIN_PREFIXES = ("http://localhost", "http://127.0.0.1")


class _InvalidJson(Exception):
    """Raised internally when a request body is not valid JSON."""


def list_strategies(strategies_dir: str | Path) -> list[dict[str, str]]:
    """List public strategy modules, sorted by name, with docstring descriptions."""
    entries: list[dict[str, str]] = []
    for path in sorted(Path(strategies_dir).glob("*.py"), key=lambda item: item.name):
        name = path.stem
        if name == "__init__" or name.startswith("_"):
            continue
        entries.append({"name": name, "description": _describe_strategy(path, name)})
    return entries


def _describe_strategy(path: Path, fallback: str) -> str:
    """Return the module docstring's first line without executing the module."""
    try:
        module = ast.parse(path.read_text(encoding="utf-8"))
        docstring = ast.get_docstring(module)
    except (OSError, SyntaxError, UnicodeDecodeError):
        return fallback
    if not docstring:
        return fallback
    first_line = docstring.strip().splitlines()[0].strip()
    return first_line or fallback


class SidecarHTTPServer(ThreadingHTTPServer):
    """Threaded server owning the session table for one sidecar process."""

    daemon_threads = True

    def __init__(self, server_address: tuple[str, int], strategies_dir: str | Path) -> None:
        super().__init__(server_address, SidecarRequestHandler)
        self.strategies_dir = resolve_strategies_dir(strategies_dir)
        self.sessions: dict[str, StrategySession] = {}
        self.session_order: list[str] = []
        self.sessions_lock = threading.Lock()

    def create_session(self, strategy: str, config: dict[str, Any] | None) -> str:
        session = StrategySession(strategy, strategies_dir=self.strategies_dir, config=config)
        session_id = uuid.uuid4().hex
        with self.sessions_lock:
            self.sessions[session_id] = session
            self.session_order.append(session_id)
        return session_id

    def get_session(self, session_id: str) -> StrategySession | None:
        with self.sessions_lock:
            return self.sessions.get(session_id)

    def delete_session(self, session_id: str) -> bool:
        with self.sessions_lock:
            return self.sessions.pop(session_id, None) is not None

    def latest_session(self) -> str | None:
        with self.sessions_lock:
            for session_id in reversed(self.session_order):
                if session_id in self.sessions:
                    return session_id
            return None


class SidecarRequestHandler(BaseHTTPRequestHandler):
    """JSON request handler with CORS support for local browser origins."""

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - stdlib signature
        """Keep request logging off stdout so the handshake line stays first."""

    # -- response helpers -------------------------------------------------

    def _cors_headers(self) -> dict[str, str]:
        headers = {
            "Access-Control-Allow-Methods": _ALLOWED_METHODS,
            "Access-Control-Allow-Headers": _ALLOWED_HEADERS,
        }
        origin = self.headers.get("Origin")
        if origin and origin.startswith(_LOCAL_ORIGIN_PREFIXES):
            headers["Access-Control-Allow-Origin"] = origin
            headers["Vary"] = "Origin"
        return headers

    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for name, value in self._cors_headers().items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def _send_empty(self, status: int) -> None:
        self.send_response(status)
        self.send_header("Content-Length", "0")
        for name, value in self._cors_headers().items():
            self.send_header(name, value)
        self.end_headers()

    # -- request helpers --------------------------------------------------

    def _path(self) -> str:
        return urlsplit(self.path).path.rstrip("/") or "/"

    def _read_json(self) -> Any:
        length_header = self.headers.get("Content-Length")
        try:
            length = int(length_header) if length_header else 0
        except ValueError as exc:
            raise _InvalidJson from exc
        raw = self.rfile.read(length) if length > 0 else b""
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise _InvalidJson from exc

    def _session_route(self, path: str) -> tuple[str, str] | None:
        parts = path.strip("/").split("/")
        if len(parts) != 3 or parts[0] != "sessions":
            return None
        session_id, action = parts[1], parts[2]
        if action not in {"allocate", "select", "reset"}:
            return None
        return session_id, action

    # -- HTTP verbs -------------------------------------------------------

    def do_OPTIONS(self) -> None:
        self._send_empty(204)

    def do_GET(self) -> None:
        path = self._path()
        if path == "/health":
            self._send_json(
                200, {"status": "ok", "session": self.server.latest_session()}
            )
            return
        if path == "/strategies":
            self._send_json(200, {"strategies": list_strategies(self.server.strategies_dir)})
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:
        path = self._path()
        if path == "/sessions":
            self._create_session()
            return

        route = self._session_route(path)
        if route is None:
            self._send_json(404, {"error": "not found"})
            return

        session_id, action = route
        session = self.server.get_session(session_id)
        if session is None:
            self._send_json(404, {"error": "unknown session"})
            return

        if action == "allocate":
            self._allocate(session)
        elif action == "select":
            self._select(session)
        else:
            self._reset(session)

    def do_DELETE(self) -> None:
        path = self._path()
        parts = path.strip("/").split("/")
        if len(parts) == 2 and parts[0] == "sessions":
            if self.server.delete_session(parts[1]):
                self._send_json(200, {"status": "ok"})
            else:
                self._send_json(404, {"error": "unknown session"})
            return
        self._send_json(404, {"error": "not found"})

    # -- endpoint implementations ----------------------------------------

    def _create_session(self) -> None:
        try:
            payload = self._read_json()
        except _InvalidJson:
            self._send_json(400, {"error": "invalid JSON"})
            return
        if not isinstance(payload, dict):
            self._send_json(400, {"error": "request body must be an object"})
            return

        strategy = payload.get("strategy")
        config = payload.get("config")
        if not isinstance(strategy, str):
            self._send_json(400, {"error": "unknown strategy"})
            return

        try:
            session_id = self.server.create_session(strategy, config)
        except ValueError as exc:
            self._send_json(400, {"error": str(exc) or "unknown strategy"})
            return
        except Exception as exc:  # noqa: BLE001 - strategy failures become 500s
            self._send_json(500, {"error": _error_text(exc)})
            return

        self._send_json(200, {"sessionId": session_id, "strategy": strategy})

    def _allocate(self, session: StrategySession) -> None:
        try:
            observation = self._read_json()
        except _InvalidJson:
            self._send_json(400, {"error": "invalid JSON"})
            return
        if not isinstance(observation, dict):
            self._send_json(400, {"error": "observation must be an object"})
            return

        try:
            result = session.allocate(observation)
        except Exception as exc:  # noqa: BLE001 - strategy failures become 500s
            self._send_json(500, {"error": _error_text(exc)})
            return
        self._send_json(200, result)

    def _select(self, session: StrategySession) -> None:
        try:
            payload = self._read_json()
        except _InvalidJson:
            self._send_json(400, {"error": "invalid JSON"})
            return
        if not isinstance(payload, dict) or not isinstance(payload.get("strategy"), str):
            self._send_json(400, {"error": "unknown strategy"})
            return

        strategy = payload["strategy"]
        try:
            session.select(strategy)
        except ValueError as exc:
            self._send_json(400, {"error": str(exc) or "unknown strategy"})
            return
        except Exception as exc:  # noqa: BLE001 - strategy failures become 500s
            self._send_json(500, {"error": _error_text(exc)})
            return
        self._send_json(200, {"strategy": strategy})

    def _reset(self, session: StrategySession) -> None:
        try:
            session.reset()
        except Exception as exc:  # noqa: BLE001 - strategy failures become 500s
            self._send_json(500, {"error": _error_text(exc)})
            return
        self._send_json(200, {"status": "ok"})


def _error_text(exc: Exception) -> str:
    return str(exc) or exc.__class__.__name__


def create_server(
    port: int = 0, strategies_dir: str | Path = DEFAULT_STRATEGIES_DIR
) -> SidecarHTTPServer:
    """Create (but do not start) a sidecar server bound to 127.0.0.1."""
    return SidecarHTTPServer(("127.0.0.1", port), strategies_dir)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Robotic hive strategy sidecar")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--strategies-dir", default=str(DEFAULT_STRATEGIES_DIR))
    args = parser.parse_args(argv)

    server = create_server(port=args.port, strategies_dir=args.strategies_dir)
    handshake = {"type": "hive-sim-sidecar", "port": server.server_address[1]}
    print(json.dumps(handshake, separators=(",", ":")), flush=True)

    def shutdown_handler(signum: int, frame: Any) -> None:
        # shutdown() blocks until serve_forever returns, so run it off-thread.
        threading.Thread(target=server.shutdown, daemon=True).start()

    try:
        signal.signal(signal.SIGTERM, shutdown_handler)
        signal.signal(signal.SIGINT, shutdown_handler)
    except (ValueError, OSError):
        # Signal handlers can only be installed from the main thread.
        pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
