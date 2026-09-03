from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal

from .codex_delivery import CodexAppServer, CodexBusyError
from .screen_buffer import ScreenReplayBuffer, cleanup_paths

CaptureKind = Literal["screenshot", "replay"]


@dataclass(frozen=True, slots=True)
class DeliveryStatus:
    mode: str = "READY"
    detail: str = ""
    last_sent: float | None = None


class CaptureController:
    def __init__(self, screen_buffer: ScreenReplayBuffer, codex: CodexAppServer,
                 replay_seconds: Callable[[], int]) -> None:
        self.buffer = screen_buffer
        self.codex = codex
        self.replay_seconds = replay_seconds
        self._queue: queue.Queue[tuple[CaptureKind, str, tuple[Path, ...] | None] | None] = queue.Queue(
            maxsize=2)
        self._status = DeliveryStatus()
        self._status_lock = threading.Lock()
        self._pending: tuple[CaptureKind, str, tuple[Path, ...]] | None = None
        self._stop = threading.Event()
        self._worker = threading.Thread(target=self._run, name="airpointer-delivery", daemon=True)
        self._worker.start()

    def trigger(self, kind: CaptureKind, thread_id: str) -> None:
        if not thread_id:
            self._set_status("SELECT AGENT", "Choose an Agent target")
            return
        try:
            self._queue.put_nowait((kind, thread_id, None))
            self._set_status("CAPTURING", "Current screen" if kind == "screenshot" else "Recent replay")
        except queue.Full:
            self._set_status("QUEUE FULL", "Wait for the current capture")

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
            kind, thread_id, paths = task
            if paths is None:
                try:
                    paths = (self.buffer.capture_still() if kind == "screenshot" else
                             self.buffer.export_recent(int(self.replay_seconds())))
                except Exception as error:
                    self._set_status("CAPTURE FAILED", str(error))
                    continue
            self._deliver(kind, thread_id, paths)

    def _deliver(self, kind: CaptureKind, thread_id: str, paths: tuple[Path, ...]) -> None:
        prompt = ("현재 화면을 캡처했습니다. 화면에서 발생한 문제를 분석해 주세요." if kind == "screenshot" else
                  "문제가 발생하기 직전 화면 기록입니다. 첨부 이미지는 과거에서 현재 순서입니다. "
                  "화면 변화를 분석해 원인과 해결 방법을 알려 주세요.")
        self._set_status("SENDING", f"{len(paths)} image(s)")
        while not self._stop.is_set():
            try:
                self.codex.send(thread_id, prompt, paths)
            except CodexBusyError as error:
                self._set_status("QUEUED", str(error))
                self._stop.wait(2.0)
                continue
            except Exception as error:
                self._pending = (kind, thread_id, paths)
                self._set_status("SEND FAILED", str(error))
                return
            cleanup_paths(paths)
            self._pending = None
            self._set_status("SENT TO CODEX", "", time.time())
            return

    def _set_status(self, mode: str, detail: str = "", last_sent: float | None = None) -> None:
        with self._status_lock:
            self._status = DeliveryStatus(mode, detail, last_sent or self._status.last_sent)
