import json
import shutil
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

import cv2
import numpy as np

import airpointer.screen_buffer as screen_buffer
from airpointer.capture_controller import CaptureController
from airpointer.screen_buffer import (
    ChangeEvent,
    ScreenReplayBuffer,
    Segment,
    _bbox_element_label,
    _bbox_label,
    _ChangeTracker,
    _frame_to_screen_point,
    _frame_to_screen_rect,
    _select_notable_moments,
    read_and_clear_region_hint,
)


def test_bbox_label_maps_corners_and_center() -> None:
    width, height = 300, 200
    assert _bbox_label((210, 140, 290, 190), width, height) == "오른쪽 아래"
    assert _bbox_label((10, 10, 90, 60), width, height) == "왼쪽 위"
    assert _bbox_label((0, 80, 300, 120), width, height) == "가운데"
    assert _bbox_label((0, 0, 300, 200), 0, 0) == "가운데"


def test_select_notable_moments_carries_bbox_and_element_label_for_events_only() -> None:
    segment = Segment(Path("seg.mp4"), started=0.0, ended=1.0, size=1)
    event = ChangeEvent(started_at=0.2, peak_at=0.5, ended_at=0.6,
                        peak_score=0.5, bbox=(80, 10, 120, 40), element_label="저장 버튼")
    picks = _select_notable_moments([segment], [event], count=1)
    assert picks == [(segment, 0.5, (80, 10, 120, 40), "저장 버튼")]

    # element_label is carried through as-is, including None -- this
    # function does no UI Automation querying of its own (that already
    # happened at event-close time, see _ChangeTracker.observe).
    unnamed_event = ChangeEvent(started_at=0.2, peak_at=0.5, ended_at=0.6,
                                 peak_score=0.5, bbox=(80, 10, 120, 40))
    unnamed_picks = _select_notable_moments([segment], [unnamed_event], count=1)
    assert unnamed_picks == [(segment, 0.5, (80, 10, 120, 40), None)]

    # A quiet window (no events) falls back to the old boundary/midpoint
    # behavior, and must report no bbox/element_label for it.
    quiet_picks = _select_notable_moments([segment], [], count=1)
    assert quiet_picks == [(segment, None, None, None)]


def test_read_and_clear_region_hint_formats_lines_and_deletes_sidecar(tmp_path: Path) -> None:
    folder = tmp_path / "abc123"
    folder.mkdir()
    frame1, frame2, frame3 = (folder / "frame-01.png", folder / "frame-02.png", folder / "frame-03.png")
    for path in (frame1, frame2, frame3):
        path.write_bytes(b"png")
    sidecar = folder / "frame-regions.json"
    sidecar.write_text(json.dumps({"frame-02.png": "오른쪽 아래"}), encoding="utf-8")

    hint = read_and_clear_region_hint((frame1, frame2, frame3))

    assert hint == "화면 변화 감지: 2번째 프레임, 오른쪽 아래 영역"
    assert not sidecar.exists()


def test_read_and_clear_region_hint_is_empty_when_no_sidecar(tmp_path: Path) -> None:
    frame = tmp_path / "screenshot-x.png"
    frame.write_bytes(b"png")
    assert read_and_clear_region_hint((frame,)) == ""
    assert read_and_clear_region_hint(()) == ""


@contextmanager
def _ascii_tmp_dir():
    """cv2.imwrite silently fails (returns False, no exception) on an
    absolute Windows path containing non-ASCII characters -- and this repo
    itself lives under such a path (OneDrive\\문서\\...). pytest's tmp_path
    fixture resolves underneath the repo, so any test that writes real video
    frames through cv2 (as export_recent does) needs a path outside it.
    Production is unaffected: ScreenReplayBuffer's real root is
    %LOCALAPPDATA%, which is all-ASCII for this user."""
    root = Path(tempfile.mkdtemp(prefix="airpointer-region-hint-"))
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _write_segment(path: Path, color: int, size: tuple[int, int] = (120, 90), fps: int = 5) -> None:
    width, height = size
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    assert writer.isOpened()
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    frame[:] = color
    for _ in range(fps):
        writer.write(frame)
    writer.release()


def test_export_recent_writes_region_sidecar_for_a_detected_change() -> None:
    with _ascii_tmp_dir() as tmp_path:
        buffer = ScreenReplayBuffer(lambda: 60, lambda: 5, tmp_path / "replay")
        now = time.time()
        segment_path = buffer.root / "segment.mp4"
        buffer.root.mkdir(parents=True, exist_ok=True)
        _write_segment(segment_path, color=200)
        segment = Segment(segment_path, started=now - 1.0, ended=now, size=segment_path.stat().st_size)
        # A toast in the bottom-right corner of a 120x90 recorded frame.
        event = ChangeEvent(started_at=now - 0.8, peak_at=now - 0.5, ended_at=now - 0.3,
                            peak_score=0.2, bbox=(90, 70, 118, 88))
        buffer._segments.append(segment)
        buffer._events.append(event)

        paths = buffer.export_recent(seconds=5, frame_count=1)

        assert len(paths) == 1
        sidecar = paths[0].parent / "frame-regions.json"
        assert json.loads(sidecar.read_text(encoding="utf-8")) == {paths[0].name: "오른쪽 아래"}

        hint = read_and_clear_region_hint(paths)
        assert hint == "화면 변화 감지: 1번째 프레임, 오른쪽 아래 영역"
        assert not sidecar.exists()


def test_export_recent_writes_no_sidecar_for_a_quiet_window() -> None:
    with _ascii_tmp_dir() as tmp_path:
        buffer = ScreenReplayBuffer(lambda: 60, lambda: 5, tmp_path / "replay")
        now = time.time()
        segment_path = buffer.root / "segment.mp4"
        buffer.root.mkdir(parents=True, exist_ok=True)
        _write_segment(segment_path, color=100)
        segment = Segment(segment_path, started=now - 1.0, ended=now, size=segment_path.stat().st_size)
        buffer._segments.append(segment)

        paths = buffer.export_recent(seconds=5, frame_count=1)

        assert not (paths[0].parent / "frame-regions.json").exists()
        assert read_and_clear_region_hint(paths) == ""


class _RecordingCodex:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def send(self, thread_id: str, prompt: str, images: tuple[Path, ...],
              kind: str = "screenshot", window_history: str = "") -> None:
        self.calls.append({"thread_id": thread_id, "prompt": prompt, "images": images,
                            "kind": kind, "window_history": window_history})

    def close(self) -> None:
        pass


def test_capture_controller_folds_region_hint_into_window_history() -> None:
    with _ascii_tmp_dir() as tmp_path:
        buffer = ScreenReplayBuffer(lambda: 60, lambda: 5, tmp_path / "replay")
        now = time.time()
        segment_path = buffer.root / "segment.mp4"
        buffer.root.mkdir(parents=True, exist_ok=True)
        _write_segment(segment_path, color=200)
        segment = Segment(segment_path, started=now - 1.0, ended=now, size=segment_path.stat().st_size)
        event = ChangeEvent(started_at=now - 0.8, peak_at=now - 0.5, ended_at=now - 0.3,
                            peak_score=0.2, bbox=(90, 70, 118, 88))
        buffer._segments.append(segment)
        buffer._events.append(event)

        codex = _RecordingCodex()
        controller = CaptureController(buffer, codex, replay_seconds=lambda: 5,
                                        window_history=lambda: "창 전환: Chrome → VS Code")
        try:
            controller.trigger("replay", "thr_test")
            deadline = time.time() + 5
            while not codex.calls and time.time() < deadline:
                time.sleep(0.05)
        finally:
            controller.close()

        assert len(codex.calls) == 1
        history = codex.calls[0]["window_history"]
        assert history == ("창 전환: Chrome → VS Code\n"
                            "화면 변화 감지: 1번째 프레임, 오른쪽 아래 영역")


class _FakeSct:
    def __init__(self, monitor: dict) -> None:
        self.monitors = [monitor]


def test_frame_to_screen_point_maps_using_current_monitor_geometry(monkeypatch) -> None:
    # A 1280x720 recorded frame is a 2x downscale of this 2560x1440 monitor,
    # which itself sits at a (100, 50) offset (e.g. a secondary monitor to
    # the right of/above a primary one) -- both the scale and the offset
    # must be undone to land on the right physical screen pixel.
    monitor = {"left": 100, "top": 50, "width": 2560, "height": 1440}
    monkeypatch.setattr(screen_buffer, "_get_sct", lambda: _FakeSct(monitor))

    point = _frame_to_screen_point((600, 300, 700, 400), 1280, 720)

    assert point == (1400, 750)


def test_frame_to_screen_point_returns_none_without_monitor_geometry(monkeypatch) -> None:
    monkeypatch.setattr(screen_buffer, "_get_sct", lambda: _FakeSct(
        {"left": 0, "top": 0, "width": 0, "height": 0}))
    assert _frame_to_screen_point((0, 0, 10, 10), 1280, 720) is None
    assert _frame_to_screen_point((0, 0, 10, 10), 0, 0) is None


def test_frame_to_screen_rect_maps_using_current_monitor_geometry(monkeypatch) -> None:
    # Same geometry as test_frame_to_screen_point_maps_using_current_monitor_geometry,
    # but keeping all four corners (needed to crop the region for OCR) instead
    # of collapsing to the bbox center.
    monitor = {"left": 100, "top": 50, "width": 2560, "height": 1440}
    monkeypatch.setattr(screen_buffer, "_get_sct", lambda: _FakeSct(monitor))

    rect = _frame_to_screen_rect((600, 300, 700, 400), 1280, 720)

    assert rect == (1300, 650, 1500, 850)


def test_frame_to_screen_rect_returns_none_without_monitor_geometry(monkeypatch) -> None:
    monkeypatch.setattr(screen_buffer, "_get_sct", lambda: _FakeSct(
        {"left": 0, "top": 0, "width": 0, "height": 0}))
    assert _frame_to_screen_rect((0, 0, 10, 10), 1280, 720) is None
    assert _frame_to_screen_rect((0, 0, 10, 10), 0, 0) is None


def test_bbox_element_label_delegates_to_selection_context_lookup(monkeypatch) -> None:
    monkeypatch.setattr(screen_buffer, "_frame_to_screen_point", lambda *args: (500, 400))
    monkeypatch.setattr("airpointer.selection_context.element_label_at", lambda x, y: "저장 버튼")

    assert _bbox_element_label((0, 0, 10, 10), 100, 100) == "저장 버튼"


def test_bbox_element_label_returns_none_without_a_screen_point(monkeypatch) -> None:
    monkeypatch.setattr(screen_buffer, "_frame_to_screen_point", lambda *args: None)
    assert _bbox_element_label((0, 0, 10, 10), 100, 100) is None


def test_bbox_element_label_retries_once_after_a_delay_when_the_first_attempt_finds_nothing(monkeypatch) -> None:
    # A window that just appeared can take a beat before Windows exposes it
    # to UI Automation -- confirmed against a real, freshly launched
    # Notepad. The second attempt (same point, a short delay later) is
    # where this actually succeeds.
    monkeypatch.setattr(screen_buffer, "_frame_to_screen_point", lambda *args: (500, 400))
    responses = iter([None, "저장 버튼"])
    calls: list[tuple[int, int]] = []

    def fake_element_label_at(x, y):
        calls.append((x, y))
        return next(responses)
    monkeypatch.setattr("airpointer.selection_context.element_label_at", fake_element_label_at)
    sleeps: list[float] = []
    monkeypatch.setattr(screen_buffer.time, "sleep", lambda seconds: sleeps.append(seconds))

    assert _bbox_element_label((0, 0, 10, 10), 100, 100) == "저장 버튼"
    assert calls == [(500, 400), (500, 400)]
    assert sleeps == [screen_buffer._ELEMENT_LABEL_RETRY_DELAY]


def test_bbox_element_label_does_not_retry_when_the_first_attempt_already_succeeds(monkeypatch) -> None:
    # The common case (an element that was already on screen) must not pay
    # the retry delay at all.
    monkeypatch.setattr(screen_buffer, "_frame_to_screen_point", lambda *args: (500, 400))
    calls: list[tuple[int, int]] = []

    def fake_element_label_at(x, y):
        calls.append((x, y))
        return "저장 버튼"
    monkeypatch.setattr("airpointer.selection_context.element_label_at", fake_element_label_at)
    sleeps: list[float] = []
    monkeypatch.setattr(screen_buffer.time, "sleep", lambda seconds: sleeps.append(seconds))

    assert _bbox_element_label((0, 0, 10, 10), 100, 100) == "저장 버튼"
    assert len(calls) == 1
    assert sleeps == []


def test_bbox_element_label_falls_back_to_ocr_when_ui_automation_finds_nothing(monkeypatch) -> None:
    # Some apps (games, custom-rendered/canvas UI, remote desktop clients)
    # never expose an accessibility tree at all -- UI Automation legitimately
    # finds nothing there no matter how long you wait, so this reads the
    # region's pixels via OCR instead of giving up straight to the quadrant
    # label. See docs/replay-change-detection.md's "OCR 폴백" section.
    monkeypatch.setattr(screen_buffer, "_frame_to_screen_point", lambda *args: (500, 400))
    monkeypatch.setattr("airpointer.selection_context.element_label_at", lambda x, y: None)
    monkeypatch.setattr(screen_buffer.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(screen_buffer, "_frame_to_screen_rect", lambda *args: (490, 390, 510, 410))
    monkeypatch.setattr("airpointer.ocr_fallback.text_label_at", lambda rect: "SAVE")

    assert _bbox_element_label((0, 0, 10, 10), 100, 100) == "SAVE"


def test_bbox_element_label_returns_none_when_ui_automation_and_ocr_both_find_nothing(monkeypatch) -> None:
    monkeypatch.setattr(screen_buffer, "_frame_to_screen_point", lambda *args: (500, 400))
    monkeypatch.setattr("airpointer.selection_context.element_label_at", lambda x, y: None)
    monkeypatch.setattr(screen_buffer.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(screen_buffer, "_frame_to_screen_rect", lambda *args: (490, 390, 510, 410))
    monkeypatch.setattr("airpointer.ocr_fallback.text_label_at", lambda rect: None)

    assert _bbox_element_label((0, 0, 10, 10), 100, 100) is None


def test_bbox_element_label_returns_none_when_ui_automation_fails_and_no_screen_rect_is_available(monkeypatch) -> None:
    # A screen point resolved but the rect didn't (same underlying monitor
    # query, asked twice) -- must still fail closed to None, never raise.
    monkeypatch.setattr(screen_buffer, "_frame_to_screen_point", lambda *args: (500, 400))
    monkeypatch.setattr("airpointer.selection_context.element_label_at", lambda x, y: None)
    monkeypatch.setattr(screen_buffer.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(screen_buffer, "_frame_to_screen_rect", lambda *args: None)

    assert _bbox_element_label((0, 0, 10, 10), 100, 100) is None


def test_bbox_element_label_tries_ocr_even_when_ui_automation_itself_raises(monkeypatch) -> None:
    # An exception from element_label_at (COM not ready, off-Windows, ...)
    # must not skip the OCR tier -- it's an independent mechanism, not
    # dependent on UI Automation's own COM state.
    monkeypatch.setattr(screen_buffer, "_frame_to_screen_point", lambda *args: (500, 400))

    def _raise(x, y):
        raise RuntimeError("COM not ready")
    monkeypatch.setattr("airpointer.selection_context.element_label_at", _raise)
    monkeypatch.setattr(screen_buffer, "_frame_to_screen_rect", lambda *args: (490, 390, 510, 410))
    monkeypatch.setattr("airpointer.ocr_fallback.text_label_at", lambda rect: "SAVE")

    assert _bbox_element_label((0, 0, 10, 10), 100, 100) == "SAVE"


def test_export_recent_surfaces_the_element_label_the_change_event_already_resolved() -> None:
    # element_label is resolved once, at event-CLOSE time by _ChangeTracker
    # (see the dedicated test below) -- export_recent() just reads
    # ChangeEvent.element_label back out, it does not query UI Automation
    # itself. So this constructs the event with element_label already set,
    # the same way _ChangeTracker would have.
    with _ascii_tmp_dir() as tmp_path:
        buffer = ScreenReplayBuffer(lambda: 60, lambda: 5, tmp_path / "replay")
        now = time.time()
        segment_path = buffer.root / "segment.mp4"
        buffer.root.mkdir(parents=True, exist_ok=True)
        _write_segment(segment_path, color=200)
        segment = Segment(segment_path, started=now - 1.0, ended=now, size=segment_path.stat().st_size)
        event = ChangeEvent(started_at=now - 0.8, peak_at=now - 0.5, ended_at=now - 0.3,
                            peak_score=0.2, bbox=(90, 70, 118, 88), element_label="저장 버튼")
        buffer._segments.append(segment)
        buffer._events.append(event)

        paths = buffer.export_recent(seconds=5, frame_count=1)

        sidecar = paths[0].parent / "frame-regions.json"
        assert json.loads(sidecar.read_text(encoding="utf-8")) == {paths[0].name: "저장 버튼"}

        hint = read_and_clear_region_hint(paths)
        assert hint == "화면 변화 감지: 1번째 프레임, 저장 버튼 영역"


def _corner_change_frames() -> tuple[np.ndarray, np.ndarray]:
    """A quiet 120x90 frame and one with a bottom-right corner spike large
    enough to trip the tile threshold -- same magnitude/position as the
    "toast in the bottom-right corner" used throughout this file."""
    quiet = np.full((90, 120, 3), 50, dtype=np.uint8)
    changed = quiet.copy()
    changed[60:90, 90:120] = 220
    return quiet, changed


def test_change_tracker_resolves_element_label_once_at_event_close_time() -> None:
    calls: list[tuple[tuple[int, int, int, int], int, int]] = []

    def fake_element_label(bbox, width, height):
        calls.append((bbox, width, height))
        return "저장 버튼"

    tracker = _ChangeTracker(fake_element_label)
    quiet, changed = _corner_change_frames()

    assert tracker.observe(quiet, at=0.0) is None    # establishes the baseline thumbnail
    assert tracker.observe(changed, at=0.1) is None  # appears -- event starts
    assert tracker.observe(quiet, at=0.2) is None    # disappears -- still a diff vs the changed frame
    assert tracker.observe(quiet, at=0.3) is None     # 1st truly quiet frame (quiet vs quiet)
    event = tracker.observe(quiet, at=0.4)             # 2nd quiet frame -- closes the event

    assert event is not None
    assert event.element_label == "저장 버튼"
    # Resolved exactly once, at close -- not once per frame while the
    # change is ongoing (that would mean a UI Automation round-trip, with
    # its own overlay hide/show, on every single captured frame).
    assert len(calls) == 1
    bbox, width, height = calls[0]
    assert (width, height) == (120, 90)
    assert bbox == event.bbox


def test_change_tracker_leaves_element_label_none_when_the_resolver_finds_nothing() -> None:
    tracker = _ChangeTracker(lambda bbox, width, height: None)
    quiet, changed = _corner_change_frames()

    tracker.observe(quiet, at=0.0)
    tracker.observe(changed, at=0.1)
    tracker.observe(quiet, at=0.2)
    tracker.observe(quiet, at=0.3)
    event = tracker.observe(quiet, at=0.4)

    assert event is not None
    assert event.element_label is None
