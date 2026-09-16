import io
import json
import time
import urllib.error
from pathlib import Path

import numpy as np
from PIL import Image

from airpointer import codex_delivery
from airpointer.codex_delivery import CodexAppServerDelivery, CodexBusyError
from airpointer.region_selection import RegionSelector
from airpointer.screen_buffer import ScreenReplayBuffer, Segment, _evenly_spaced
from airpointer.settings import Settings

def test_mouse_drag_resizes_region_and_release_confirms_it() -> None:
    selector = RegionSelector()
    selector.start()
    assert selector.press(120, 140).phase == "selecting"
    resized = selector.drag(620, 440)
    assert resized.rect == (120, 140, 620, 440)
    view, captured = selector.release()
    assert view.phase == "idle" and not view.active
    assert captured == (120, 140, 620, 440)


def test_too_small_drag_is_rejected_and_stays_open_for_retry() -> None:
    selector = RegionSelector(min_size=32)
    selector.start()
    selector.press(100, 100)
    selector.drag(105, 104)
    view, captured = selector.release()
    assert captured is None
    assert view.phase == "waiting" and view.active


def test_reset_cancels_selection() -> None:
    selector = RegionSelector()
    selector.start()
    selector.press(10, 10)
    selector.drag(200, 200)
    selector.reset()
    assert not selector.active
    assert selector.view().phase == "idle"


def test_region_capture_writes_only_selected_image(tmp_path: Path) -> None:
    requested = []

    def grab_region(rect):
        requested.append(rect)
        return Image.new("RGB", (rect[2] - rect[0], rect[3] - rect[1]), "red")

    buffer = ScreenReplayBuffer(lambda: 10, lambda: 5, tmp_path / "replay",
                                grab_region=grab_region)
    path, = buffer.capture_region((10, 20, 210, 120))
    with Image.open(path) as image:
        assert image.size == (200, 100)
    assert requested == [(10, 20, 210, 120)]


def test_buffer_prunes_by_age_and_size(tmp_path: Path) -> None:
    buffer = ScreenReplayBuffer(lambda: 10, lambda: 5, tmp_path / "replay", max_bytes=10,
                                grab=lambda: np.zeros((8, 8, 3), dtype=np.uint8))
    old = buffer.root / "old.mp4"
    recent = buffer.root / "recent.mp4"
    old.write_bytes(b"123456")
    recent.write_bytes(b"123456")
    now = time.time()
    buffer._segments.extend((Segment(old, now - 20, now - 19, 6),
                             Segment(recent, now - 1, now, 6)))
    buffer._prune(now)
    assert not old.exists()
    assert recent.exists()
    assert list(buffer._segments) == [Segment(recent, now - 1, now, 6)]


def test_evenly_spaced_keeps_time_order(tmp_path: Path) -> None:
    items = [Segment(tmp_path / f"{index}.mp4", index, index + 1, 1) for index in range(10)]
    assert [item.started for item in _evenly_spaced(items, 4)] == [0, 3, 6, 9]


def test_settings_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "settings.json"
    Settings(replay_minutes=5, agent_thread_id="thr_test").save(path)
    loaded = Settings.load(path)
    assert loaded.replay_minutes == 5 and loaded.agent_thread_id == "thr_test"


def test_codex_send_posts_frames_as_data_urls(tmp_path: Path) -> None:
    image = tmp_path / "screen.png"
    image.write_bytes(b"png")
    server = CodexAppServerDelivery()
    calls = []

    def request(method, path, body=None):
        calls.append((method, path, body))
        return {"delivered": True}

    server._request = request
    server.send("thr_test", "Look", (image,))
    method, path, body = calls[-1]
    assert method == "POST" and path == "/api/agent"
    assert body["threadId"] == "thr_test"
    assert body["userPrompt"] == "Look"
    assert body["frames"][0].startswith("data:image/png;base64,")


def test_codex_busy_response_raises_busy_error(monkeypatch) -> None:
    server = CodexAppServerDelivery()

    def fake_urlopen(_request, timeout=None):
        body = json.dumps({"queued": True, "error": "Agent is busy; capture is queued"}).encode("utf-8")
        raise urllib.error.HTTPError("http://x/api/agent", 409, "busy", None, io.BytesIO(body))

    monkeypatch.setattr(codex_delivery.urllib.request, "urlopen", fake_urlopen)
    try:
        server.send("thr_test", "Look", ())
    except CodexBusyError as error:
        assert "busy" in str(error).lower()
    else:
        raise AssertionError("a 409 response must be treated as a retryable busy state")


def test_codex_connection_failure_mentions_dev_server(monkeypatch) -> None:
    server = CodexAppServerDelivery()

    def fake_urlopen(_request, timeout=None):
        raise urllib.error.URLError("Connection refused")

    monkeypatch.setattr(codex_delivery.urllib.request, "urlopen", fake_urlopen)
    try:
        server.list_threads()
    except RuntimeError as error:
        assert "npm run dev" in str(error)
    else:
        raise AssertionError("an unreachable dev server must raise a clear, actionable error")
