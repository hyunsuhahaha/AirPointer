from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal

from .codex_delivery import CodexAppServerDelivery, CodexBusyError, DesktopPasteDelivery
from .region_selection import Region
from .screen_buffer import ScreenReplayBuffer, cleanup_paths

CaptureKind = Literal["screenshot", "region", "replay"]


@dataclass(frozen=True, slots=True)
class DeliveryStatus:
    mode: str = "READY"
    detail: str = ""
    last_sent: float | None = None


class CaptureController:
    def __init__(self, screen_buffer: ScreenReplayBuffer,
                 codex: CodexAppServerDelivery | DesktopPasteDelivery,
                 replay_seconds: Callable[[], int],
                 window_history: Callable[[], str] | None = None) -> None:
        self.buffer = screen_buffer
        self.codex = codex
        self.replay_seconds = replay_seconds
        self.window_history = window_history or (lambda: "")
        self._queue: queue.Queue[
            tuple[CaptureKind, str, Region | None, tuple[Path, ...] | None, str | None] | None
        ] = queue.Queue(maxsize=2)
        self._status = DeliveryStatus()
        self._status_lock = threading.Lock()
        self._pending: tuple[CaptureKind, str, Region | None, tuple[Path, ...], str | None] | None = None
        self._stop = threading.Event()
        self._worker = threading.Thread(target=self._run, name="airpointer-delivery", daemon=True)
        self._worker.start()

    def trigger(self, kind: CaptureKind, thread_id: str, region: Region | None = None) -> None:
        if not thread_id:
            self._set_status("SELECT AGENT", "Choose an Agent target")
            return
        try:
            self._queue.put_nowait((kind, thread_id, region, None, None))
            detail = ("Selected area" if kind == "region" else
                      "Current screen" if kind == "screenshot" else "Recent replay")
            self._set_status("CAPTURING", detail)
        except queue.Full:
            self._set_status("QUEUE FULL", "Wait for the current capture")

    def send_prepared(self, kind: CaptureKind, thread_id: str, paths: tuple[Path, ...],
                      prompt: str) -> bool:
        if not thread_id or not paths or not prompt.strip():
            self._set_status("PROMPT REQUIRED", "Select a task and enter a question")
            return False
        try:
            self._queue.put_nowait((kind, thread_id, None, paths, prompt.strip()))
            self._set_status("QUEUED", "Question and frozen replay")
            return True
        except queue.Full:
            self._set_status("QUEUE FULL", "Wait for the current capture")
            return False

    def retry(self) -> None:
        pending, self._pending = self._pending, None
        if pending:
            try:
                self._queue.put_nowait(pending)
                self._set_status("QUEUED", "Retrying previous capture")
            except queue.Full:
                self._pending = pending
                self._set_status("QUEUE FULL", "Wait for the current capture")

    def status(self) -> DeliveryStatus:
        with self._status_lock:
            return self._status

    def close(self) -> None:
        self._stop.set()
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass
        self.buffer.stop(clear=True)
        self.codex.close()
        self._worker.join(timeout=2.0)

    def _run(self) -> None:
        while not self._stop.is_set():
            task = self._queue.get()
            if task is None:
                return
            kind, thread_id, region, paths, prompt = task
            if paths is None:
                try:
                    if kind == "screenshot":
                        paths = self.buffer.capture_still()
                    elif kind == "region":
                        if region is None:
                            raise ValueError("Selected capture area is missing")
                        paths = self.buffer.capture_region(region)
                    else:
                        paths = self.buffer.export_recent(int(self.replay_seconds()))
                except Exception as error:
                    self._set_status("CAPTURE FAILED", str(error))
                    continue
            self._deliver(kind, thread_id, paths, prompt)

    def _deliver(self, kind: CaptureKind, thread_id: str, paths: tuple[Path, ...],
                 user_prompt: str | None = None) -> None:
        # The actual context sentence and default question live server-side
        # (web/src/app/api/agent/route.ts's makePrompt/CAPTURE_CONTEXT), keyed
        # off `kind`, exactly like a browser-originated capture -- so sending
        # the same request from AirPointer or from the website produces the
        # same prompt instead of AirPointer double-wrapping its own text
        # inside the server's template.
        self._set_status("SENDING", f"{len(paths)} image(s)")
        while not self._stop.is_set():
            try:
                self.codex.send(thread_id, (user_prompt or "").strip(), paths, kind,
                                 window_history=self.window_history())
            except CodexBusyError as error:
                self._set_status("QUEUED", str(error))
                self._stop.wait(2.0)
                continue
            except Exception as error:
                self._pending = (kind, thread_id, None, paths, user_prompt)
                self._set_status("SEND FAILED", str(error))
                return
            cleanup_paths(paths)
            self._pending = None
            self._set_status("SENT TO CODEX", "", time.time())
            return

    def _set_status(self, mode: str, detail: str = "", last_sent: float | None = None) -> None:
        with self._status_lock:
            self._status = DeliveryStatus(mode, detail, last_sent or self._status.last_sent)
