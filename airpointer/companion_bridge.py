from __future__ import annotations

import base64
import io
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable
from urllib.parse import parse_qs, urlparse

from PIL import Image

from .command_gesture import CommandView
from .hotkeys import parse_binding

# (target, threadId, prompt, kind, frame data-URLs) -> {"ok": True} or
# {"error": str}. Set once by App after it constructs its own CaptureController
# (see main.py's _deliver_companion_capture) -- CompanionHttpServer is built
# before App exists (see airpointer_launcher.py), so it can't be handed a
# direct reference at construction time; going through CompanionState (which
# both already share) avoids restructuring that startup order.
DeliveryHandler = Callable[[str, str, str, str, list[str]], dict]

# target -> list of {"id", "title", "status", "project"} dicts, project-block
# ordered (see App._list_companion_threads). Same registration story as
# DeliveryHandler above.
ThreadsHandler = Callable[[str], list[dict]]


class CompanionState:
    """Thread-safe state shared by the native detector, overlay, and web UI."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._tokens: set[str] = set()
        self._agent_thread_id = ""
        self._gestures = {"replay": True, "screenshot": True, "region": True}
        # Empty until the browser sends bindings -- App falls back to the
        # local Settings file's own hotkeys in that case (see main.py's
        # _resolve_hotkey_bindings), so an un-configured companion never
        # silently disables the feature.
        self._hotkeys: dict[str, str] = {}
        # "" means "browser hasn't asked for a target" -- App keeps using
        # whatever the local Settings/native SEND TO radio has, same
        # not-configured-yet fallback shape as _hotkeys above. Set only via
        # the browser's own "보낼 곳" picker (see replay-workspace.tsx) so a
        # hotkey/gesture capture and the browser's own screen-share capture
        # stop silently targeting two different apps (see App._sync_delivery_target).
        self._delivery_target = ""
        self._running = False
        self._mode: str | None = None
        self._camera_ready = False
        self._pose = "none"
        self._phase = "idle"
        self._progress = 0.0
        self._route: str | None = None
        self._replay_event = 0
        self._preview = ""
        self._last_preview_at = 0.0
        self._delivery_handler: DeliveryHandler | None = None
        self._threads_handler: ThreadsHandler | None = None

    def authorize(self, token: str) -> None:
        if token:
            with self._lock:
                self._tokens.add(token)
                while len(self._tokens) > 32:
                    self._tokens.pop()

    def set_running(self, running: bool, mode: str | None = None) -> None:
        with self._lock:
            self._running = running
            self._mode = mode if running else None
            if not running:
                self._camera_ready = False
                self._pose = "none"
                self._phase = "idle"
                self._progress = 0.0
                self._route = None
                self._preview = ""

    def configure(self, token: str, agent_thread_id: str,
                  gestures: dict[str, bool] | None = None,
                  hotkeys: dict[str, str] | None = None,
                  delivery_target: str | None = None) -> bool:
        with self._lock:
            if not token or token not in self._tokens:
                return False
            self._agent_thread_id = agent_thread_id.strip()[:256]
            if delivery_target in ("codex", "claude"):
                self._delivery_target = delivery_target
            if gestures:
                for key in self._gestures:
                    if key in gestures:
                        self._gestures[key] = bool(gestures[key])
            if hotkeys is not None:
                # Invalid entries (typo'd modifier, no modifier at all) are
                # dropped rather than rejecting the whole update -- one bad
                # combo shouldn't take the other two actions' hotkeys down too.
                self._hotkeys = {action: combo for action, combo in hotkeys.items()
                                 if action in self._gestures and parse_binding(combo)}
            return True

    def agent_thread_id(self) -> str:
        with self._lock:
            return self._agent_thread_id

    def delivery_target(self) -> str:
        with self._lock:
            return self._delivery_target

    def set_delivery_handler(self, handler: DeliveryHandler) -> None:
        with self._lock:
            self._delivery_handler = handler

    def deliver(self, token: str, target: str, thread_id: str, prompt: str,
                kind: str, frames: list[str]) -> tuple[int, dict]:
        """Runs the browser's own screen-share capture through the native
        app's delivery backend (Codex Desktop or Claude Desktop -- see
        airpointer/desktop_paste.py) instead of reimplementing that UI
        automation a second time in the web app's Node process."""
        with self._lock:
            if not token or token not in self._tokens:
                return 403, {"error": "unauthorized"}
            handler = self._delivery_handler
        if handler is None:
            return 503, {"error": "AirPointer가 아직 준비되지 않았습니다."}
        try:
            return 200, handler(target, thread_id, prompt, kind, frames)
        except Exception as error:
            return 500, {"error": str(error)}

    def set_threads_handler(self, handler: ThreadsHandler) -> None:
        with self._lock:
            self._threads_handler = handler

    def list_threads(self, token: str, target: str) -> tuple[int, dict]:
        """Lets the browser's own agent picker (see replay-workspace.tsx)
        show Claude Desktop's conversations grouped by project, same as it
        already does for Codex -- reads through the native app's own
        DesktopPasteDelivery.list_threads() (airpointer/desktop_paste.py's
        sidebar reverse-engineering) instead of a second Node-side
        implementation."""
        with self._lock:
            if not token or token not in self._tokens:
                return 403, {"error": "unauthorized", "threads": []}
            handler = self._threads_handler
        if handler is None:
            return 503, {"error": "AirPointer가 아직 준비되지 않았습니다.", "threads": []}
        try:
            return 200, {"threads": handler(target)}
        except Exception as error:
            return 500, {"error": str(error), "threads": []}

    def gesture_flags(self) -> tuple[bool, bool, bool]:
        with self._lock:
            return self._gestures["replay"], self._gestures["screenshot"], self._gestures["region"]

    def hotkeys(self) -> dict[str, str]:
        with self._lock:
            return dict(self._hotkeys)

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
                "mode": self._mode,
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
                if parsed.path == "/status":
                    self._handle_status(parsed)
                elif parsed.path == "/threads":
                    self._handle_threads(parsed)
                else:
                    self.send_error(404)

            def _handle_status(self, parsed) -> None:
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

            def _handle_threads(self, parsed) -> None:
                query = parse_qs(parsed.query)
                token = query.get("token", [""])[0]
                target = query.get("target", ["codex"])[0]
                if target not in ("codex", "claude"):
                    self.send_error(400)
                    return
                status, result = state_ref.list_threads(token, target)
                body = json.dumps(result, separators=(",", ":")).encode("utf-8")
                self.send_response(status)
                self._cors()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:
                parsed = urlparse(self.path)
                if parsed.path == "/config":
                    self._handle_config(parsed)
                elif parsed.path == "/send":
                    self._handle_send(parsed)
                else:
                    self.send_error(404)

            def _handle_config(self, parsed) -> None:
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
                    raw_hotkeys = payload.get("hotkeys", {})
                    if not isinstance(raw_hotkeys, dict) or any(
                            not isinstance(key, str) or not isinstance(value, str) or len(value) > 64
                            for key, value in raw_hotkeys.items()):
                        raise ValueError("hotkeys must contain strings")
                    delivery_target = payload.get("deliveryTarget")
                    if delivery_target is not None and delivery_target not in ("codex", "claude"):
                        raise ValueError("deliveryTarget must be 'codex' or 'claude'")
                except (ValueError, json.JSONDecodeError):
                    self.send_error(400)
                    return
                if not state_ref.configure(token, thread_id, raw_gestures, raw_hotkeys, delivery_target):
                    self.send_error(403)
                    return
                self.send_response(204)
                self._cors()
                self.end_headers()

            def _handle_send(self, parsed) -> None:
                # Lets the browser's own screen-share capture (getDisplayMedia,
                # not AirPointer's gesture/hotkey pipeline) reach either Codex
                # Desktop or Claude Desktop through the same UI-automation
                # delivery the native app already uses for its own captures --
                # see App._deliver_companion_capture in main.py.
                token = parse_qs(parsed.query).get("token", [""])[0]
                try:
                    length = min(int(self.headers.get("Content-Length", "0")), 32 * 1024 * 1024)
                    payload = json.loads(self.rfile.read(length))
                    target = payload.get("target", "codex")
                    thread_id = payload.get("threadId", "")
                    prompt = payload.get("prompt", "")
                    kind = payload.get("kind", "screenshot")
                    frames = payload.get("frames", [])
                    if (target not in ("codex", "claude") or not isinstance(thread_id, str)
                            or not isinstance(prompt, str) or len(prompt) > 2000
                            or kind not in ("screenshot", "region", "replay")
                            or not isinstance(frames, list) or not frames or len(frames) > 6
                            or not all(isinstance(frame, str) for frame in frames)):
                        raise ValueError("invalid /send payload")
                except (ValueError, json.JSONDecodeError):
                    self.send_error(400)
                    return
                status, result = state_ref.deliver(token, target, thread_id, prompt, kind, frames)
                body = json.dumps(result, separators=(",", ":")).encode("utf-8")
                self.send_response(status)
                self._cors()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

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
