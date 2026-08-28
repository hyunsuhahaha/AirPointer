import time

from airpointer import cursor as cursor_module
from airpointer.cursor import CursorController
from airpointer.gesture import Intent
from airpointer.hand_tracker import Point
from airpointer.settings import Settings
from airpointer.ui_snap import SnapResult


class NoSnap:
    def nearest(self, x: int, y: int):
        return None

    def close(self) -> None:
        pass


def test_absolute_pointing_reaches_left_edge_from_right_side(monkeypatch) -> None:
    monkeypatch.setattr(cursor_module.pyautogui, "size", lambda: (1000, 1000))
    monkeypatch.setattr(cursor_module.pyautogui, "position",
                        lambda: type("Position", (), {"x": 900, "y": 500})())
    monkeypatch.setattr(cursor_module.pyautogui, "moveTo", lambda *args, **kwargs: None)
    controller = CursorController(Settings(snap_enabled=False), NoSnap())
    try:
        state = controller.apply(Intent("tracking", Point(0.15, 0.5)))
        assert state is not None
        assert state.point_x == 0
    finally:
        controller.close()


def test_cursor_interpolates_between_camera_frames(monkeypatch) -> None:
    moves: list[tuple[int, int]] = []
    monkeypatch.setattr(cursor_module.pyautogui, "size", lambda: (1000, 1000))
    monkeypatch.setattr(cursor_module.pyautogui, "position",
                        lambda: type("Position", (), {"x": 0, "y": 0})())
    monkeypatch.setattr(cursor_module.pyautogui, "moveTo",
                        lambda x, y, **kwargs: moves.append((int(x), int(y))))
    controller = CursorController(Settings(snap_enabled=False), NoSnap())
    try:
        controller.apply(Intent("tracking", Point(0.5, 0.5)))
        controller.apply(Intent("tracking", Point(0.7, 0.5)))
        time.sleep(0.12)
        assert len(moves) >= 5
    finally:
        close = getattr(controller, "close", None)
        if close:
            close()


def test_pinch_commits_locked_target_once(monkeypatch) -> None:
    clicks: list[tuple[int, int]] = []
    moves: list[tuple[int, int]] = []
    monkeypatch.setattr(cursor_module.pyautogui, "size", lambda: (1000, 1000))
    monkeypatch.setattr(cursor_module.pyautogui, "position",
                        lambda: type("Position", (), {"x": 100, "y": 100})())
    monkeypatch.setattr(cursor_module.pyautogui, "moveTo",
                        lambda x, y, **kwargs: moves.append((round(x), round(y))))
    monkeypatch.setattr(cursor_module.pyautogui, "click",
                        lambda **kwargs: clicks.append((controller._target_x, controller._target_y)))

    class LockedSnap(NoSnap):
        def nearest(self, x: int, y: int):
            return SnapResult(222, 333, (200, 300, 260, 350))

    controller = CursorController(Settings(), LockedSnap())
    try:
        point = Point(0.5, 0.5)
        controller.apply(Intent("tracking", point))
        controller.apply(Intent("pinch", point))
        assert not clicks
        controller.apply(Intent("tracking", point, event="click"))
        assert len(clicks) == 1
        assert (222, 333) in moves
    finally:
        controller.close()
