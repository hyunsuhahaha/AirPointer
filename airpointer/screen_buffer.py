from __future__ import annotations

import os
import shutil
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from PIL import Image, ImageGrab

from .region_selection import Region


@dataclass(frozen=True, slots=True)
class Segment:
    path: Path
    started: float
    ended: float
    size: int


@dataclass(frozen=True, slots=True)
class BufferStatus:
    running: bool
    seconds: float
    size_bytes: int
    error: str = ""


class ScreenReplayBuffer:
    """Owns screen capture, bounded segment storage, and recent-frame export."""

    def __init__(self, retention_seconds: Callable[[], int], fps: Callable[[], int],
                 root: Path | None = None, max_bytes: int = 250 * 1024 * 1024,
                 grab: Callable[[], np.ndarray] | None = None,
                 grab_region: Callable[[Region], Image.Image] | None = None) -> None:
        local = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        self.root = (root or local / "AirPointer" / "replay").resolve()
        self.dispatch = self.root.parent / "dispatch"
        self.retention_seconds = retention_seconds
        self.fps = fps
        self.max_bytes = max_bytes
        self._grab = grab or _grab_screen
        self._grab_region = grab_region or _grab_region
        self._segments: deque[Segment] = deque()
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._error = ""
        self._clean_directory(self.root)
        self._clean_directory(self.dispatch)

    @property
    def running(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def start(self) -> None:
        if self.running:
            return
        self.root.mkdir(parents=True, exist_ok=True)
        self.dispatch.mkdir(parents=True, exist_ok=True)
        self._error = ""
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="airpointer-screen-buffer", daemon=True)
        self._thread.start()

    def stop(self, clear: bool = True) -> None:
        self._stop.set()
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=3.0)
        if clear:
            self.clear(include_dispatch=True)

    def clear(self, include_dispatch: bool = False) -> None:
        with self._lock:
            paths = [segment.path for segment in self._segments]
            self._segments.clear()
        for path in paths:
            path.unlink(missing_ok=True)
        if not self.running:
            self._clean_directory(self.root)
        if include_dispatch:
            self._clean_directory(self.dispatch)

    def status(self) -> BufferStatus:
        with self._lock:
            segments = tuple(self._segments)
        seconds = max(0.0, segments[-1].ended - segments[0].started) if segments else 0.0
        return BufferStatus(self.running, seconds, sum(item.size for item in segments), self._error)

    def capture_still(self) -> tuple[Path, ...]:
        self.dispatch.mkdir(parents=True, exist_ok=True)
        path = self.dispatch / f"screenshot-{uuid.uuid4().hex}.png"
        if not cv2.imwrite(str(path), self._grab()):
            raise RuntimeError("Could not save screenshot")
        return (path,)

    def capture_region(self, rect: Region) -> tuple[Path, ...]:
        left, top, right, bottom = rect
        if right <= left or bottom <= top:
            raise ValueError("Capture region must have a positive width and height")
        self.dispatch.mkdir(parents=True, exist_ok=True)
        path = self.dispatch / f"region-{uuid.uuid4().hex}.png"
        self._grab_region(rect).convert("RGB").save(path, format="PNG")
        return (path,)

    def export_recent(self, seconds: int, frame_count: int = 6) -> tuple[Path, ...]:
        cutoff = time.time() - max(1, seconds)
        paths: list[Path] = []
        with self._lock:
            segments = [item for item in self._segments if item.ended >= cutoff and item.path.exists()]
            if not segments:
                raise RuntimeError("Replay buffer is not ready yet")
            chosen = _evenly_spaced(segments, min(frame_count, len(segments)))
            folder = self.dispatch / uuid.uuid4().hex
            folder.mkdir(parents=True, exist_ok=True)
            for index, segment in enumerate(chosen, 1):
                capture = cv2.VideoCapture(str(segment.path))
                try:
                    count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
                    capture.set(cv2.CAP_PROP_POS_FRAMES, max(0, count // 2))
                    ok, frame = capture.read()
                finally:
                    capture.release()
                if ok:
                    path = folder / f"frame-{index:02d}.png"
                    if cv2.imwrite(str(path), frame):
                        paths.append(path)
        if not paths:
            shutil.rmtree(folder, ignore_errors=True)
            raise RuntimeError("Could not extract replay frames")
        return tuple(paths)

    def _run(self) -> None:
        try:
            while not self._stop.is_set():
                self._record_segment()
                self._prune(time.time())
        except Exception as error:
            self._error = str(error)

    def _record_segment(self) -> None:
        started = time.time()
        frame = self._grab()
        height, width = frame.shape[:2]
        path = self.root / f"{started:.3f}.part.mp4"
        final_path = self.root / path.name.replace(".part", "")
        rate = max(1, int(self.fps()))
        writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), rate, (width, height))
        if not writer.isOpened():
            raise RuntimeError("MP4 screen encoder is unavailable")
        deadline = time.monotonic() + 1.0
        interval = 1.0 / rate
        next_frame = time.monotonic()
        try:
            while not self._stop.is_set() and time.monotonic() < deadline:
                now = time.monotonic()
                if now < next_frame:
                    self._stop.wait(next_frame - now)
                    continue
                if frame.shape[1] != width or frame.shape[0] != height:
                    frame = cv2.resize(frame, (width, height), interpolation=cv2.INTER_AREA)
                writer.write(frame)
                next_frame += interval
                if next_frame < deadline:
                    frame = self._grab()
        finally:
            writer.release()
        if not path.exists():
            return
        path.replace(final_path)
        ended = time.time()
        segment = Segment(final_path, started, ended, final_path.stat().st_size)
        with self._lock:
            self._segments.append(segment)

    def _prune(self, now: float) -> None:
        cutoff = now - max(1, int(self.retention_seconds()))
        with self._lock:
            total = sum(item.size for item in self._segments)
            expired: list[Segment] = []
            while self._segments and (self._segments[0].ended < cutoff or total > self.max_bytes):
                item = self._segments.popleft()
                total -= item.size
                expired.append(item)
        for item in expired:
            item.path.unlink(missing_ok=True)

    @staticmethod
    def _clean_directory(path: Path) -> None:
        path.mkdir(parents=True, exist_ok=True)
        for child in path.iterdir():
            if child.is_file():
                child.unlink(missing_ok=True)
            elif child.is_dir():
                shutil.rmtree(child, ignore_errors=True)


def _grab_screen() -> np.ndarray:
    image = ImageGrab.grab(all_screens=True).convert("RGB")
    frame = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)
    height, width = frame.shape[:2]
    scale = min(1.0, 1280 / width, 720 / height)
    if scale < 1.0:
        frame = cv2.resize(frame, (round(width * scale), round(height * scale)),
                           interpolation=cv2.INTER_AREA)
    return frame


def _grab_region(rect: Region) -> Image.Image:
    return ImageGrab.grab(bbox=rect, all_screens=True)


def _evenly_spaced(items: list[Segment], count: int) -> list[Segment]:
    if count <= 1:
        return [items[-1]]
    return [items[round(index * (len(items) - 1) / (count - 1))] for index in range(count)]


def cleanup_paths(paths: tuple[Path, ...]) -> None:
    parents = {path.parent for path in paths}
    for path in paths:
        path.unlink(missing_ok=True)
    for parent in parents:
        try:
            parent.rmdir()
        except OSError:
            pass
