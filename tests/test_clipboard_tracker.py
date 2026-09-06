import time
from pathlib import Path

import airpointer.clipboard_tracker as clipboard_tracker
from airpointer.capture_controller import CaptureController
from airpointer.clipboard_tracker import ClipboardEvent, ClipboardTracker
from airpointer.screen_buffer import ScreenReplayBuffer


def _fake_clipboard(monkeypatch, script: list[tuple[int, bool, str]]):
    """script is a list of (sequence_number, has_text, text) snapshots --
    each call to _poll() consumes the next one, standing in for real
    GetClipboardSequenceNumber()/GetClipboardData() so tests never touch
    this machine's actual clipboard."""
    state = {"index": -1}

    def sequence_number():
        return script[state["index"]][0]

    def read_text():
        _, has_text, text = script[state["index"]]
        return text if has_text else ""

    def advance():
        state["index"] += 1

    monkeypatch.setattr(clipboard_tracker, "_sequence_number", sequence_number)
    monkeypatch.setattr(clipboard_tracker, "_read_clipboard_text", read_text)
    return advance


def test_recent_summary_chains_sequential_copies_oldest_to_newest(monkeypatch) -> None:
    advance = _fake_clipboard(monkeypatch, [
        (1, True, "A"),
        (2, True, "B"),
        (3, True, "C"),
    ])
    tracker = ClipboardTracker()
    for _ in range(3):
        advance()
        tracker._poll()

    assert tracker.recent_summary() == "A → B → C"


def test_unchanged_sequence_number_is_not_recorded_twice(monkeypatch) -> None:
    advance = _fake_clipboard(monkeypatch, [
        (1, True, "A"),
        (1, True, "A"),  # same sequence number -- nothing actually changed
    ])
    tracker = ClipboardTracker()
    advance()
    tracker._poll()
    advance()
    tracker._poll()

    assert tracker.recent_summary() == "A"


def test_non_text_clipboard_content_is_ignored(monkeypatch) -> None:
    # A copied image/file bumps the sequence number but has no CF_UNICODETEXT.
    advance = _fake_clipboard(monkeypatch, [(1, False, "")])
    tracker = ClipboardTracker()
    advance()
    tracker._poll()

    assert tracker.recent_summary() == ""


def test_old_entries_age_out_by_retention() -> None:
    tracker = ClipboardTracker(retention_seconds=30.0)
    now = time.time()
    tracker._events.append(ClipboardEvent(now - 40, "옛날에 복사한 것"))
    tracker._events.append(ClipboardEvent(now - 5, "방금 복사한 것"))

    assert tracker.recent_summary() == "방금 복사한 것"


def test_suppress_delivery_hides_changes_until_resumed(monkeypatch) -> None:
    advance = _fake_clipboard(monkeypatch, [
        (1, True, "user text"),
        (2, True, "AirPointer's own prompt paste"),
        (3, True, "next real copy"),
    ])
    tracker = ClipboardTracker()
    advance()
    tracker._poll()  # the user's own copy, tracked normally

    tracker.suppress_delivery()
    advance()
    tracker._poll()  # AirPointer's own clipboard write during delivery -- must be ignored

    assert tracker.recent_summary() == "user text"

    tracker.resume_after_delivery()
    # Still within the trailing grace window (real time.monotonic(), no
    # sleep needed since resume_after_delivery() just set it ~0.5s ahead).
    advance()
    tracker._poll()

    assert tracker.recent_summary() == "user text", "a change right after resume must still be ignored (trailing grace)"


def test_clipboard_tracker_thread_starts_and_stops_cleanly(monkeypatch) -> None:
    monkeypatch.setattr(clipboard_tracker, "_sequence_number", lambda: 1)
    monkeypatch.setattr(clipboard_tracker, "_read_clipboard_text", lambda: "")
    tracker = ClipboardTracker(poll_interval=0.01)

    tracker.start()
    assert tracker.running
    time.sleep(0.05)
    tracker.stop()

    assert not tracker.running


class _FlakyThenOkCodex:
    """Raises CodexBusyError once, then succeeds -- exercises the retry
    loop inside CaptureController._deliver/_send_until_done."""

    def __init__(self) -> None:
        self.attempts = 0
        self.sent: list[dict] = []

    def send(self, thread_id: str, prompt: str, images: tuple[Path, ...],
              kind: str = "screenshot", window_history: str = "") -> None:
        from airpointer.codex_delivery import CodexBusyError
        self.attempts += 1
        if self.attempts == 1:
            raise CodexBusyError("busy")
        self.sent.append({"window_history": window_history})

    def close(self) -> None:
        pass


def test_delivery_hooks_bracket_the_whole_retry_loop_once(tmp_path: Path) -> None:
    buffer = ScreenReplayBuffer(lambda: 60, lambda: 5, tmp_path / "replay")
    screenshot_path = buffer.dispatch / "screenshot-x.png"
    buffer.dispatch.mkdir(parents=True, exist_ok=True)
    screenshot_path.write_bytes(b"fake-png")

    codex = _FlakyThenOkCodex()
    starts, ends = [], []
    controller = CaptureController(
        buffer, codex, replay_seconds=lambda: 5,
        on_delivery_start=lambda: starts.append(time.time()),
        on_delivery_end=lambda: ends.append(time.time()))
    try:
        controller._deliver("screenshot", "thr_test", (screenshot_path,))
    finally:
        controller.close()

    assert codex.attempts == 2, "must have retried once after CodexBusyError"
    assert len(codex.sent) == 1
    assert len(starts) == 1 and len(ends) == 1, \
        "on_delivery_start/end must bracket the whole retry loop, not fire per attempt"
