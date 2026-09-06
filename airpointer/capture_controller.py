from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal

from .codex_delivery import CodexAppServerDelivery, CodexBusyError, DesktopPasteDelivery
from .desktop_paste import CODEX
from .region_selection import Region
from .screen_buffer import ScreenReplayBuffer, cleanup_paths, read_and_clear_region_hint, read_manifest_hint

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
                 window_history: Callable[[], str] | None = None,
                 on_sent: Callable[[tuple[Path, ...]], None] | None = None,
                 on_delivery_start: Callable[[], None] | None = None,
                 on_delivery_end: Callable[[], None] | None = None) -> None:
        self.buffer = screen_buffer
        self.codex = codex
        self.replay_seconds = replay_seconds
        self.window_history = window_history or (lambda: "")
        # Lets ClipboardTracker ignore the clipboard writes DesktopPasteDelivery
        # itself makes while sending (image + prompt paste) so they never show
        # up as if the user had copied them -- see clipboard_tracker.py.
        # Called even when nothing is actually listening (no-op lambdas).
        self.on_delivery_start = on_delivery_start or (lambda: None)
        self.on_delivery_end = on_delivery_end or (lambda: None)
        # Lets the browser mirror what a gesture/hotkey-triggered send
        # actually delivered (see main.App._publish_sent_frames) -- browser-
        # originated captures already show their own frames locally
        # (replay-workspace.tsx's own `frames` state), but a native capture
        # never reached the browser at all before this, since it goes
        # straight to Codex/Claude Desktop via desktop_paste.py.
        self.on_sent = on_sent or (lambda _paths: None)
        self._queue: queue.Queue[
            tuple[CaptureKind, str, Region | None, tuple[Path, ...] | None, str | None, str] | None
        ] = queue.Queue(maxsize=2)
        self._status = DeliveryStatus()
        self._status_lock = threading.Lock()
        self._pending: tuple[CaptureKind, str, Region | None, tuple[Path, ...], str | None, str] | None = None
        self._stop = threading.Event()
        self._worker = threading.Thread(target=self._run, name="airpointer-delivery", daemon=True)
        self._worker.start()

    def trigger(self, kind: CaptureKind, thread_id: str, region: Region | None = None) -> None:
        if not thread_id:
            self._set_status("SELECT AGENT", "Choose an Agent target")
            return
        try:
            self._queue.put_nowait((kind, thread_id, region, None, None, ""))
            detail = ("Selected area" if kind == "region" else
                      "Current screen" if kind == "screenshot" else "Recent replay")
            self._set_status("CAPTURING", detail)
        except queue.Full:
            self._set_status("QUEUE FULL", "Wait for the current capture")

    def send_prepared(self, kind: CaptureKind, thread_id: str, paths: tuple[Path, ...],
                      prompt: str, extra_context: str = "") -> bool:
        # extra_context is whatever main.App captured at freeze() time (e.g.
        # "선택 텍스트: ...", see selection_context.py) -- a one-shot value
        # tied to this specific capture, unlike window_history which is
        # re-read fresh at send time from a rolling log.
        if not thread_id or not paths or not prompt.strip():
            self._set_status("PROMPT REQUIRED", "Select a task and enter a question")
            return False
        try:
            self._queue.put_nowait((kind, thread_id, None, paths, prompt.strip(), extra_context))
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
            kind, thread_id, region, paths, prompt, extra_context = task
            if paths is None:
                try:
                    if kind == "screenshot":
                        paths = self.buffer.capture_still()
                    elif kind == "region":
                        if region is None:
                            raise ValueError("Selected capture area is missing")
                        paths = self.buffer.capture_region(region)
                    else:
                        # Same Codex-only gating as _deliver()'s manifest_hint below.
                        paths = self.buffer.export_recent(
                            int(self.replay_seconds()),
                            with_manifest=getattr(self.codex, "target", None) is CODEX)
                except Exception as error:
                    self._set_status("CAPTURE FAILED", str(error))
                    continue
            self._deliver(kind, thread_id, paths, prompt, extra_context)

    def _deliver(self, kind: CaptureKind, thread_id: str, paths: tuple[Path, ...],
                 user_prompt: str | None = None, extra_context: str = "") -> None:
        # The actual context sentence and default question live server-side
        # (web/src/app/api/agent/route.ts's makePrompt/CAPTURE_CONTEXT), keyed
        # off `kind`, exactly like a browser-originated capture -- so sending
        # the same request from AirPointer or from the website produces the
        # same prompt instead of AirPointer double-wrapping its own text
        # inside the server's template.
        self._set_status("SENDING", f"{len(paths)} image(s)")
        # Read once, before the send loop: a replay export may have dropped a
        # frame-regions.json sidecar (see screen_buffer.export_recent) noting
        # which picked frame(s) actually came from a detected screen change,
        # and where on screen -- folding that into window_history gives the
        # agent a spatial anchor instead of making it scan the whole image.
        # Screenshot/region captures and quiet replay windows have no
        # sidecar, so this is "" for them.
        region_hint = read_and_clear_region_hint(paths)
        # Codex-only (see docs/replay-change-detection.md) -- Claude Desktop
        # has no built-in shell/local-file tool to act on this instruction
        # with, so it would just be dead text in its prompt. getattr(...) is
        # None (never CODEX) for CodexAppServerDelivery, which is fine: that
        # class is never actually instantiated by main.py today.
        manifest_hint = read_manifest_hint(paths) if getattr(self.codex, "target", None) is CODEX else ""
        # Brackets every attempt in this delivery (including CodexBusyError
        # retries below, still the same in-flight send) so ClipboardTracker
        # ignores the clipboard writes DesktopPasteDelivery itself makes for
        # the whole time, not just around one attempt.
        self.on_delivery_start()
        try:
            self._send_until_done(kind, thread_id, paths, user_prompt, region_hint, extra_context, manifest_hint)
        finally:
            self.on_delivery_end()

    def _send_until_done(self, kind: CaptureKind, thread_id: str, paths: tuple[Path, ...],
                          user_prompt: str | None, region_hint: str, extra_context: str = "",
                          manifest_hint: str = "") -> None:
        while not self._stop.is_set():
            try:
                history = self.window_history()
                if region_hint:
                    history = f"{history}\n{region_hint}" if history else region_hint
                if manifest_hint:
                    history = f"{history}\n{manifest_hint}" if history else manifest_hint
                if extra_context:
                    history = f"{history}\n{extra_context}" if history else extra_context
                self.codex.send(thread_id, (user_prompt or "").strip(), paths, kind,
                                 window_history=history)
            except CodexBusyError as error:
                self._set_status("QUEUED", str(error))
                self._stop.wait(2.0)
                continue
            except Exception as error:
                self._pending = (kind, thread_id, None, paths, user_prompt, extra_context)
                self._set_status("SEND FAILED", str(error))
                return
            try:
                self.on_sent(paths)
            except Exception:
                pass  # best-effort mirror to the browser -- never block cleanup/status over it
            cleanup_paths(paths)
            self._pending = None
            self._set_status(f"SENT TO {self._delivery_tag()}", "", time.time())
            return

    def _delivery_tag(self) -> str:
        # Mirrors main.py's App._delivery_tag() so "SENT TO ..." matches
        # whatever the SEND TO radio is actually set to (Codex/Claude Desktop)
        # instead of always saying CODEX. CodexAppServerDelivery (and the
        # fakes in tests/test_clipboard_tracker.py) have no `target` -- they
        # only ever talk to Codex -- so that case falls back to "CODEX".
        target = getattr(self.codex, "target", None)
        return target.label.split()[0].upper() if target else "CODEX"

    def _set_status(self, mode: str, detail: str = "", last_sent: float | None = None) -> None:
        with self._status_lock:
            self._status = DeliveryStatus(mode, detail, last_sent or self._status.last_sent)
