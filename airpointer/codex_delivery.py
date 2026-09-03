from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request
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
    """Sends capture requests through the local AirPointer web app's
    `/api/agent` route instead of spawning a Codex App Server subprocess
    directly. AirPointer.exe is an unsigned, frequently-rebuilt binary, so
    Windows Smart App Control tends to block it from launching child
    processes; the web app (already running for the browser companion,
    port 3000 by default) already has a working path to Codex."""

    def __init__(self, base_url: str = "http://127.0.0.1:3000", request_timeout: float = 45.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.request_timeout = request_timeout

    def list_threads(self, cwd: str | None = None) -> list[AgentThread]:
        payload = self._request("GET", "/api/agent")
        threads = []
        for item in payload.get("threads", []):
            title = item.get("title") or item.get("id", "Untitled")
            threads.append(AgentThread(str(item["id"]), _one_line(str(title)),
                                       str(item.get("status", "unknown"))))
        return threads

    def send(self, thread_id: str, prompt: str, images: tuple[Path, ...]) -> None:
        if not thread_id:
            raise RuntimeError("Select an Agent target first")
        body = {
            "threadId": thread_id,
            "mode": "current",
            "seconds": 0,
            "frames": [_to_data_url(path) for path in images],
            "userPrompt": prompt,
        }
        self._request("POST", "/api/agent", body)

    def close(self) -> None:
        pass

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Content-Type": "application/json"} if data is not None else {}
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self.request_timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            payload = _read_json(error)
            message = payload.get("error") or f"AirPointer 웹 서버 오류 (HTTP {error.code})"
            if error.code == 409 or payload.get("queued"):
                raise CodexBusyError(message) from error
            raise RuntimeError(message) from error
        except urllib.error.URLError as error:
            raise RuntimeError(
                f"AirPointer 웹 서버({self.base_url})에 연결할 수 없습니다. "
                f"`npm run dev`가 실행 중인지 확인하세요. ({error.reason})") from error


def _read_json(error: urllib.error.HTTPError) -> dict:
    try:
        return json.loads(error.read().decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        return {}


def _to_data_url(path: Path) -> str:
    mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def _one_line(value: str, limit: int = 64) -> str:
    return " ".join(value.split())[:limit]
