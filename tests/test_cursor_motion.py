import time

from airpointer import cursor as cursor_module
from airpointer.cursor import CursorController
from airpointer.hand_tracker import Point
from airpointer.settings import Settings


class NoSnap:
    def nearest(self, x: int, y: int):
        return None


def test_cursor_interpolates_between_camera_frames(monkeypatch) -> None:
    moves: list[tuple[int, int]] = []
    monkeypatch.setattr(cursor_module.pyautogui, "size", lambda: (1000, 1000))
    monkeypatch.setattr(cursor_module.pyautogui, "position",
                        lambda: type("Position", (), {"x": 0, "y": 0})())
    monkeypatch.setattr(cursor_module.pyautogui, "moveTo",
                        lambda x, y, **kwargs: moves.append((int(x), int(y))))
    controller = CursorController(Settings(snap_enabled=False), NoSnap())
    try:
        controller.update(Point(0.7, 0.5), False)
        time.sleep(0.12)
        assert len(moves) >= 5
    finally:
        close = getattr(controller, "close", None)
        if close:
            close()


def test_default_smoothing_hides_30_fps_velocity_steps() -> None:
    alpha = Settings().smoothing
    position = 0.0
    target = 0.0
    deltas: list[float] = []
    for tick in range(80):
        if tick % 4 == 0:
            target += 100
        next_position = position + (target - position) * alpha
        if tick >= 40:
            deltas.append(next_position - position)
        position = next_position
    assert max(deltas) / min(deltas) < 1.5
