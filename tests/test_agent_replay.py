import json
import queue
import time
from pathlib import Path

import numpy as np

from airpointer.codex_delivery import CodexAppServer, _codex_command
from airpointer.command_gesture import CommandGesture
from airpointer.screen_buffer import ScreenReplayBuffer, Segment, _evenly_spaced
from airpointer.settings import Settings
from tests.test_core import _hand


def _fist():
    points = _hand()
    for tip, pip in ((8, 6), (12, 10), (16, 14), (20, 18)):
        points[tip] = points[pip]
    return points


def test_palm_then_fist_captures_once_and_requires_hand_release() -> None:
    gesture = CommandGesture()
    palm = _hand()
    assert gesture.update(palm, 0.00).phase == "arming"
    assert gesture.update(palm, 0.26).phase == "armed"
    assert gesture.update(_fist(), 0.50).event == "screenshot"
    assert gesture.update(_fist(), 0.60).event is None
    assert gesture.update(None, 0.70).phase == "idle"


def test_held_palm_exports_replay_once() -> None:
    gesture = CommandGesture()
    palm = _hand()
    gesture.update(palm, 0.00)
    gesture.update(palm, 0.26)
    assert gesture.update(palm, 1.21).event == "replay"
    assert gesture.update(palm, 1.50).event is None


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
