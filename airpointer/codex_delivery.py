from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class AgentThread:
    id: str
    title: str
    status: str


class CodexBusyError(RuntimeError):
    pass


class CodexAppServer:
    """Small synchronous interface over the Codex app-server JSON-RPC transport."""

    def __init__(self, request_timeout: float = 20.0) -> None:
        self.request_timeout = request_timeout
        self._process: subprocess.Popen[str] | None = None
        self._reader: threading.Thread | None = None
        self._write_lock = threading.Lock()
        self._lifecycle_lock = threading.RLock()
        self._pending_lock = threading.Lock()
        self._pending: dict[int, queue.Queue[dict]] = {}
        self._next_id = 0

    def list_threads(self, cwd: str | None = None) -> list[AgentThread]:
        params: dict[str, object] = {
            "limit": 50,
            "sortKey": "updated_at",
            "sortDirection": "desc",
            "sourceKinds": ["cli", "vscode", "exec", "appServer", "unknown"],
            "archived": False,
        }
        if cwd:
            params["cwd"] = cwd
        result = self._request("thread/list", params)
        threads = []
        for item in result.get("data", []):
            title = item.get("name") or item.get("preview") or item.get("id", "Untitled")
            status = item.get("status", {})
            threads.append(AgentThread(str(item["id"]), _one_line(str(title)),
                                       str(status.get("type", "unknown"))))
        return threads

    def send(self, thread_id: str, prompt: str, images: tuple[Path, ...]) -> None:
        if not thread_id:
            raise RuntimeError("Select an Agent target first")
        read = self._request("thread/read", {"threadId": thread_id, "includeTurns": False})
        status = read.get("thread", {}).get("status", {})
        if status.get("type") == "active":
            raise CodexBusyError("Agent is busy; capture is queued")
        self._request("thread/resume", {"threadId": thread_id, "excludeTurns": True})
        inputs = [{"type": "text", "text": prompt}]
        inputs.extend({"type": "localImage", "path": str(path.resolve())} for path in images)
        try:
            self._request("turn/start", {
                "threadId": thread_id,
                "turnTrigger": "airpointer_gesture",
                "input": inputs,
            })
        except RuntimeError as error:
            if _is_active_turn_error(error):
                raise CodexBusyError("Agent is busy; capture is queued") from error
            raise

    def close(self) -> None:
        with self._lifecycle_lock:
            process, self._process = self._process, None
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()

    def _request(self, method: str, params: dict) -> dict:
        self._ensure_started()
        return self._request_started(method, params)

    def _request_started(self, method: str, params: dict) -> dict:
        request_id = self._allocate_id()
        response_queue: queue.Queue[dict] = queue.Queue(maxsize=1)
        with self._pending_lock:
            self._pending[request_id] = response_queue
        try:
            self._write({"method": method, "id": request_id, "params": params})
            try:
                response = response_queue.get(timeout=self.request_timeout)
            except queue.Empty as error:
                self.close()
                raise RuntimeError(f"Codex App Server timed out during {method}") from error
        finally:
            with self._pending_lock:
                self._pending.pop(request_id, None)
        if "error" in response:
            message = response["error"].get("message", str(response["error"]))
            raise RuntimeError(f"Codex App Server: {message}")
        return response.get("result", {})

    def _ensure_started(self) -> None:
        with self._lifecycle_lock:
            if self._process and self._process.poll() is None:
                return
            command = _codex_command()
            creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            self._process = subprocess.Popen(
                command + ["app-server", "--stdio"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, text=True, encoding="utf-8", bufsize=1,
                creationflags=creationflags,
            )
            self._reader = threading.Thread(target=self._read_loop, name="airpointer-codex-reader",
                                            daemon=True)
            self._reader.start()
            try:
                self._request_started("initialize", {
                    "clientInfo": {"name": "airpointer", "title": "AirPointer", "version": "0.3.0"}
                })
                self._write({"method": "initialized", "params": {}})
            except Exception:
                process, self._process = self._process, None
                if process and process.poll() is None:
                    process.terminate()
                raise

    def _read_loop(self) -> None:
        process = self._process
        if not process or not process.stdout:
            return
        for line in process.stdout:
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            request_id = message.get("id")
            with self._pending_lock:
                target = self._pending.get(request_id)
            if target:
                target.put(message)

    def _write(self, message: dict) -> None:
        process = self._process
        if not process or not process.stdin:
            raise RuntimeError("Codex App Server is not running")
        with self._write_lock:
            process.stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
            process.stdin.flush()

    def _allocate_id(self) -> int:
        with self._pending_lock:
            self._next_id += 1
            return self._next_id


def _codex_command() -> list[str]:
    executable = shutil.which("codex.exe") or shutil.which("codex.cmd") or shutil.which("codex")
    if not executable:
        raise RuntimeError("Codex CLI was not found. Install or update Codex first")
    if os.name == "nt" and Path(executable).suffix.lower() in (".cmd", ".bat"):
        return [os.environ.get("COMSPEC", "cmd.exe"), "/d", "/c", executable]
    return [executable]


def _one_line(value: str, limit: int = 64) -> str:
    return " ".join(value.split())[:limit]


def _is_active_turn_error(error: Exception) -> bool:
    message = str(error).casefold()
    return "active turn" in message or "thread is active" in message
