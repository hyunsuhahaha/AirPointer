from pathlib import Path

import numpy as np
import pytest

from airpointer import memory_ingest
from airpointer.memory_store import MemoryStore
from airpointer.screen_buffer import ChangeEvent, ScreenReplayBuffer


class _ImmediateThread:
    """Runs the target synchronously on .start() instead of on a real
    background thread, so tests don't need to sleep/poll/join to observe
    an ingest that _ingest() itself made deterministic (stubbed OCR)."""

    def __init__(self, target, args=(), name=None, daemon=None) -> None:
        self._target = target
        self._args = args

    def start(self) -> None:
        self._target(*self._args)


@pytest.fixture(autouse=True)
def _synchronous_ingest(monkeypatch):
    monkeypatch.setattr(memory_ingest.threading, "Thread", _ImmediateThread)
    monkeypatch.setattr(memory_ingest.ocr_fallback, "recognize_frame_text", lambda image: "OCR TEXT")


def _frame() -> np.ndarray:
    return np.zeros((4, 4, 3), dtype=np.uint8)


def _event(peak_at: float = 0.0) -> ChangeEvent:
    return ChangeEvent(started_at=peak_at, peak_at=peak_at, ended_at=peak_at, peak_score=1.0, bbox=(0, 0, 1, 1))


def test_ingests_immediately_on_a_change_event(tmp_path: Path) -> None:
    ingestor = memory_ingest.ScreenMemoryIngestor(MemoryStore(tmp_path / "memory"))
    ingestor.consider(_frame(), 0.0, _event())
    frames = ingestor.store.search()
    assert len(frames) == 1
    assert frames[0]["source"] == "native"
    assert frames[0]["surface"] == "monitor"
    assert frames[0]["text"] == "OCR TEXT"


def test_skips_a_plain_frame_before_the_interval_elapses(tmp_path: Path) -> None:
    ingestor = memory_ingest.ScreenMemoryIngestor(MemoryStore(tmp_path / "memory"))
    ingestor.consider(_frame(), 0.0, None)
    ingestor.consider(_frame(), memory_ingest._MIN_INTERVAL_SECONDS - 1, None)
    assert ingestor.store.search() == []


def test_ingests_a_plain_frame_once_the_interval_elapses(tmp_path: Path) -> None:
    ingestor = memory_ingest.ScreenMemoryIngestor(MemoryStore(tmp_path / "memory"))
    ingestor.consider(_frame(), 0.0, None)
    ingestor.consider(_frame(), memory_ingest._MIN_INTERVAL_SECONDS, None)
    assert len(ingestor.store.search()) == 1


def test_skips_when_an_ingest_is_already_in_flight(tmp_path: Path) -> None:
    ingestor = memory_ingest.ScreenMemoryIngestor(MemoryStore(tmp_path / "memory"))
    ingestor._busy.acquire()
    try:
        ingestor.consider(_frame(), 0.0, _event())
    finally:
        ingestor._busy.release()
    assert ingestor.store.search() == []


def test_a_failed_ingest_still_releases_the_busy_flag(tmp_path: Path, monkeypatch) -> None:
    ingestor = memory_ingest.ScreenMemoryIngestor(MemoryStore(tmp_path / "memory"))
    monkeypatch.setattr(memory_ingest.cv2, "imencode", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    ingestor.consider(_frame(), 0.0, _event())
    assert not ingestor._busy.locked()


def test_screen_replay_buffer_calls_on_frame_for_captured_frames(tmp_path: Path) -> None:
    calls = []
    frame = np.zeros((4, 4, 3), dtype=np.uint8)
    buffer = ScreenReplayBuffer(lambda: 10, lambda: 1, tmp_path / "replay", grab=lambda: frame,
                                on_frame=lambda f, t, e: calls.append((f, t, e)))

    buffer._record_segment()

    assert len(calls) >= 1
    assert calls[0][0] is frame
