from __future__ import annotations

import base64
import io
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from PIL import Image

from .command_gesture import CommandView


class CompanionState:
    """Thread-safe state shared by the native detector, overlay, and web UI."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._tokens: set[str] = set()
        self._agent_thread_id = ""
        self._gestures = {"replay": True, "screenshot": True, "region": True}
        self._running = False
        self._camera_ready = False
        self._pose = "none"
        self._phase = "idle"
        self._progress = 0.0
        self._route: str | None = None
        self._replay_event = 0
        self._preview = ""
        self._last_preview_at = 0.0

    def authorize(self, token: str) -> None:
        if token:
            with self._lock:
                self._tokens.add(token)
                while len(self._tokens) > 32:
                    self._tokens.pop()

    def set_running(self, running: bool) -> None:
        with self._lock:
            self._running = running
            if not running:
                self._camera_ready = False
                self._pose = "none"
                self._phase = "idle"
                self._progress = 0.0
                self._route = None
                self._preview = ""

    def configure(self, token: str, agent_thread_id: str,
                  gestures: dict[str, bool] | None = None) -> bool:
        with self._lock:
            if not token or token not in self._tokens:
                return False
            self._agent_thread_id = agent_thread_id.strip()[:256]
            if gestures:
                for key in self._gestures:
                    if key in gestures:
                        self._gestures[key] = bool(gestures[key])
            return True

    def agent_thread_id(self) -> str:
        with self._lock:
            return self._agent_thread_id

    def gesture_flags(self) -> tuple[bool, bool, bool]:
        with self._lock:
            return self._gestures["replay"], self._gestures["screenshot"], self._gestures["region"]

    def publish(self, frame, pose: str, command: CommandView) -> None:
        now = time.monotonic()
        preview = None
        if frame is not None and now - self._last_preview_at >= 0.15:
            image = Image.fromarray(frame)
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=58, optimize=False)
            preview = "data:image/jpeg;base64," + base64.b64encode(output.getvalue()).decode("ascii")
            self._last_preview_at = now
        with self._lock:
            self._camera_ready = frame is not None
            self._pose = pose
            self._phase = command.phase
            self._progress = command.progress
            self._route = command.route
            if command.event == "replay":
                self._replay_event += 1
            if preview is not None:
                self._preview = preview

    def snapshot(self, token: str) -> dict[str, object] | None:
        with self._lock:
            if not token or token not in self._tokens:
                return None
            return {
                "running": self._running,
                "cameraReady": self._camera_ready,
                "pose": self._pose,
                "phase": self._phase,
                "progress": self._progress,
                "route": self._route,
                "replayEvent": self._replay_event,
                "preview": self._preview,
            }


class CompanionHttpServer:
    def __init__(self, state: CompanionState, port: int = 47822) -> None:
        self.state = state
        state_ref = state

        class Handler(BaseHTTPRequestHandler):
            def do_OPTIONS(self) -> None:
                self.send_response(204)
                self._cors()
                self.end_headers()

            def do_GET(self) -> None:
                parsed = urlparse(self.path)
                if parsed.path != "/status":
                    self.send_error(404)
                    return
                token = parse_qs(parsed.query).get("token", [""])[0]
                payload = state_ref.snapshot(token)
                if payload is None:
                    self.send_error(403)
                    return
                body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:
                parsed = urlparse(self.path)
                if parsed.path != "/config":
                    self.send_error(404)
                    return
                token = parse_qs(parsed.query).get("token", [""])[0]
                try:
                    length = min(int(self.headers.get("Content-Length", "0")), 4096)
                    payload = json.loads(self.rfile.read(length))
                    thread_id = payload.get("agentThreadId", "")
                    if not isinstance(thread_id, str):
                        raise ValueError("agentThreadId must be a string")
                    raw_gestures = payload.get("gestures", {})
                    if not isinstance(raw_gestures, dict) or any(
                            key not in {"replay", "screenshot", "region"} or not isinstance(value, bool)
                            for key, value in raw_gestures.items()):
                        raise ValueError("gestures must contain booleans")
                except (ValueError, json.JSONDecodeError):
                    self.send_error(400)
                    return
                if not state_ref.configure(token, thread_id, raw_gestures):
                    self.send_error(403)
                    return
                self.send_response(204)
                self._cors()
                self.end_headers()

            def _cors(self) -> None:
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")

            def log_message(self, _format: str, *_args) -> None:
                return

        self._server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self._thread = threading.Thread(target=self._server.serve_forever,
                                        name="airpointer-web-bridge", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=1.0)
