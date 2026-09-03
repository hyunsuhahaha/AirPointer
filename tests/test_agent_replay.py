import json
import queue
import time
from pathlib import Path

import numpy as np
from PIL import Image

from airpointer.codex_delivery import CodexAppServer, _codex_command
from airpointer.command_gesture import CommandGesture
from airpointer.region_selection import RegionSelector
from airpointer.screen_buffer import ScreenReplayBuffer, Segment, _evenly_spaced
from airpointer.settings import Settings
from tests.test_core import _hand


def _fist():
    points = _hand()
    for tip, pip in ((8, 6), (12, 10), (16, 14), (20, 18)):
        points[tip] = points[pip]
    return points


def _pointing():
    points = _hand()
    for tip, pip in ((12, 10), (16, 14), (20, 18)):
        points[tip] = points[pip]
    return points


def test_palm_then_fist_captures_current_screen_once() -> None:
    gesture = CommandGesture()
    palm = _hand()
    assert gesture.update(palm, 0.00).phase == "arming"
    assert gesture.update(palm, 0.13).phase == "armed"
    assert gesture.update(_fist(), 0.20).event == "screenshot"
    assert gesture.update(_fist(), 0.30).event is None
    assert gesture.update(None, 0.40).phase == "idle"


def test_palm_then_transition_frames_then_fist_still_captures_screen() -> None:
    gesture = CommandGesture()
    palm = _hand()
    transition = _pointing()
    assert gesture.update(palm, 0.00).phase == "arming"
    assert gesture.update(transition, 0.08).phase == "arming"
    assert gesture.update(None, 0.16).phase == "arming"
    assert gesture.update(_fist(), 0.30).event == "screenshot"


def test_fist_then_palm_starts_region_selection() -> None:
    gesture = CommandGesture()
    assert gesture.update(_fist(), 0.00).phase == "arming"
    assert gesture.update(_fist(), 0.30).event is None
    assert gesture.update(_hand(), 0.45).event == "region_select"


def test_each_capture_gesture_can_be_disabled_independently() -> None:
    palm = _hand()
    gesture = CommandGesture()
    gesture.configure(replay=False, screenshot=False, region=False)
    assert gesture.update(palm, 0.0).phase == "idle"
    assert gesture.update(_fist(), 0.2).phase == "idle"


def test_held_palm_exports_replay_once() -> None:
    gesture = CommandGesture()
    palm = _hand()
    gesture.update(palm, 0.00)
    gesture.update(palm, 0.26)
    assert gesture.update(palm, 1.21).event is None
    assert gesture.update(palm, 2.01).event == "replay"
    assert gesture.update(palm, 1.50).event is None


def test_palm_timer_progresses_continuously_over_two_seconds() -> None:
    gesture = CommandGesture()
    palm = _hand()
    assert gesture.update(palm, 0.00).progress == 0.0
    assert 0.04 <= gesture.update(palm, 0.10).progress <= 0.06
    assert 0.49 <= gesture.update(palm, 1.00).progress <= 0.51


def test_pointing_resizes_region_and_fist_confirms_it() -> None:
    selector = RegionSelector(1000, 800)
    selector.start()
    assert selector.update(_pointing(), (120, 140), 0.0).phase == "selecting"
    resized = selector.update(_pointing(), (620, 440), 0.1)
    assert resized.rect == (120, 140, 620, 440)
    assert selector.update(_fist(), None, 0.2).phase == "confirming"
    captured = selector.update(_fist(), None, 0.46)
    assert captured.captured == (120, 140, 620, 440)
    assert selector.update(None, None, 0.5).phase == "idle"


def test_region_selection_cancels_after_hand_is_lowered() -> None:
    selector = RegionSelector(1000, 800, cancel_seconds=1.0)
    selector.start()
    selector.update(_pointing(), (120, 140), 0.0)
    assert selector.update(None, None, 0.5).active
    assert not selector.update(None, None, 1.51).active


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


def test_codex_send_uses_local_images(tmp_path: Path) -> None:
    image = tmp_path / "screen.png"
    image.write_bytes(b"png")
    server = CodexAppServer()
    calls = []

    def request(method, params):
        calls.append((method, params))
        if method == "thread/read":
            return {"thread": {"status": {"type": "idle"}}}
        return {}

    server._request = request
    server.send("thr_test", "Look", (image,))
    method, params = calls[-1]
    assert method == "turn/start"
    assert params["threadId"] == "thr_test"
    assert params["input"][1] == {"type": "localImage", "path": str(image.resolve())}


def test_codex_reader_routes_response() -> None:
    server = CodexAppServer()
    target = queue.Queue(maxsize=1)
    server._pending[7] = target
    assert json.loads('{"id": 7, "result": {}}')["id"] == 7
    assert _codex_command()
