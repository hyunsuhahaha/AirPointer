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
    project: str = ""


class CodexBusyError(RuntimeError):
    pass


DEFAULT_PROMPTS = {
    "screenshot": "화면에서 발생한 문제를 분석해 주세요.",
    "region": "이 영역을 중심으로 문제를 분석해 주세요.",
    "replay": "화면 변화를 분석해 원인과 해결 방법을 알려 주세요.",
}


class CodexAppServerDelivery:
    """Sends capture requests through the local AirPointer web app's
    `/api/agent` route instead of spawning a Codex App Server subprocess
    directly. AirPointer.exe is an unsigned, frequently-rebuilt binary, so
    Windows Smart App Control tends to block it from launching child
    processes; the web app (already running for the browser companion,
    port 3000 by default) already has a working path to Codex."""

    requires_thread_selection = True
    # There's no "current" thread over HTTP -- a target must always be
    # picked explicitly, unlike DesktopPasteDelivery where leaving the
    # picker blank is a legitimate choice (whatever's already open).
    requires_explicit_target = True

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

    def send(self, thread_id: str, prompt: str, images: tuple[Path, ...],
              kind: str = "screenshot", window_history: str = "") -> None:
        if not thread_id:
            raise RuntimeError("Select an Agent target first")
        body = {
            "threadId": thread_id,
            "mode": "current",
            "kind": kind,
            "seconds": 0,
            "frames": [_to_data_url(path) for path in images],
            "userPrompt": prompt,
            "windowHistory": window_history,
        }
        self._request("POST", "/api/agent", body)

    def close(self) -> None:
        pass

    def warmup(self) -> None:
        """No-op: this backend talks to Codex over HTTP, so there's no
        Electron accessibility tree to pre-warm (see DesktopPasteDelivery)."""

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


class DesktopPasteDelivery:
    """Delivers captures via clipboard + OS keyboard automation into Codex
    Desktop (see desktop_paste.py), instead of any Codex protocol -- no
    writer lock to steal, nothing to corrupt. `thread_id`, when given, is
    matched against the sidebar's conversation titles and clicked to
    switch Codex Desktop to that conversation before sending; when empty
    or not found, it just sends to whatever conversation is already open."""

    requires_thread_selection = True
    requires_explicit_target = False
    # Lets the UI show conversations grouped like Codex Desktop's own
    # sidebar (see ConversationPicker.set_grouped) -- CodexAppServerDelivery
    # has no such concept, so its threads all carry project = "".
    supports_project_groups = True

    def list_threads(self, cwd: str | None = None) -> list[AgentThread]:
        from . import desktop_paste
        found = desktop_paste.find_codex_window_and_composer()
        if not found:
            return []
        window, _composer = found
        return [AgentThread(title, title, "unknown", project)
                for project, titles in desktop_paste.list_conversations_by_project(window)
                for title in titles]

    def send(self, thread_id: str, prompt: str, images: tuple[Path, ...],
              kind: str = "screenshot", window_history: str = "") -> None:
        if not images:
            raise RuntimeError("전송할 화면이 없습니다.")
        from . import desktop_paste
        default_prompt = DEFAULT_PROMPTS.get(kind, DEFAULT_PROMPTS["screenshot"])
        text = prompt.strip() or default_prompt
        if window_history:
            # This path never hits makePrompt() (see route.ts), so the
            # activity log has to be folded in here -- kept to one prefixed
            # block, same shape as the section makePrompt() adds server-side,
            # so the two delivery paths read the same even though they're
            # built in different places. window_history is really "recent
            # activity" now (window switches AND clicks, see main.py's
            # _activity_summary) -- kept the parameter name to avoid
            # touching every call site for a label change.
            text = f"최근 활동:\n{window_history}\n\n{text}"
        desktop_paste.paste_capture_and_ask(images, text, thread_id or None)

    def close(self) -> None:
        pass

    def warmup(self) -> None:
        """Best-effort, read-only pre-warm of Codex Desktop's UI Automation
        tree. Electron/Chromium builds its accessibility tree lazily on the
        first query against a window, which can take upward of 20-30s
        (measured); calling this once at startup, before any real send,
        hides that cost instead of the user eating it on their first
        capture. Touches no clipboard, keyboard, or focus -- safe to call
        speculatively even if Codex Desktop isn't running yet (just finds
        nothing and returns) or the caller races a real send (worst case,
        both just do the same read-only lookup)."""
        try:
            from . import desktop_paste
            desktop_paste.find_codex_window_and_composer()
        except Exception:
            pass


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
