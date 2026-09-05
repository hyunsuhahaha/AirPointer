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
import mss
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
class ChangeEvent:
    """One merged run of above-threshold screen change, produced by
    _ChangeTracker -- see the "리플레이 변화 감지" section in
    docs/replay-change-detection.md for the full design writeup (why this
    exists, the tile-scoring rationale, and known limitations)."""
    started_at: float
    peak_at: float
    ended_at: float
    peak_score: float
    bbox: tuple[int, int, int, int]  # (left, top, right, bottom), original-frame pixel coords


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
        # maxlen is a hard memory backstop, not the normal pruning path --
        # _prune() drops events past retention_seconds the same as segments,
        # this just guarantees the deque can never grow unbounded if pruning
        # ever falls behind (e.g. a very bursty change rate).
        self._events: deque[ChangeEvent] = deque(maxlen=512)
        self._change_tracker = _ChangeTracker()
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
        # Fresh tracker per start(): its _prev thumbnail and any in-progress
        # event belong to whatever was on screen before this session's last
        # stop() -- comparing against that stale frame on the very first new
        # frame would manufacture a bogus "everything changed" event.
        self._change_tracker = _ChangeTracker()
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
            self._events.clear()
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
            events = [event for event in self._events if event.peak_at >= cutoff]
            picks = _select_notable_moments(segments, events, min(frame_count, len(segments)))
            folder = self.dispatch / uuid.uuid4().hex
            folder.mkdir(parents=True, exist_ok=True)
            for index, (segment, target_at) in enumerate(picks, 1):
                capture = cv2.VideoCapture(str(segment.path))
                try:
                    count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
                    capture.set(cv2.CAP_PROP_POS_FRAMES, _frame_index_for(segment, target_at, count))
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
                event = self._change_tracker.observe(frame, time.time())
                if event is not None:
                    with self._lock:
                        self._events.append(event)
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
            while self._events and self._events[0].peak_at < cutoff:
                self._events.popleft()
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


# mss over PIL's ImageGrab for the actual pixel transfer (both ultimately do a
# GDI BitBlt, which dominates the cost at typical monitor resolutions -- this
# swap does NOT make that transfer itself much cheaper). What mss saves is
# per-instance setup, which only pays off if an instance is reused across
# calls rather than opened fresh each time -- measured ~18% faster grabs
# (57ms vs 70ms at 2560x1600) with reuse, vs. no real difference without it.
# One instance per calling thread (mss.MSS is not thread-safe, and this is
# called both from ScreenReplayBuffer's own recording thread and from
# main.App's one-off "freeze capture" threads for stills). No explicit
# close()-on-exit: mss's Windows backend holds no OS handles between grab()
# calls, so close() is an intentional no-op there (confirmed against the
# installed mss source) -- letting the thread-local entry drop when its
# thread exits is enough.
_local = threading.local()


def _get_sct() -> mss.MSS:
    sct = getattr(_local, "sct", None)
    if sct is None:
        sct = mss.MSS()
        _local.sct = sct
    return sct


def _grab_screen() -> np.ndarray:
    sct = _get_sct()
    # sct.monitors[0] is mss's combined virtual-desktop rectangle, the same
    # area ImageGrab(all_screens=True) covered. Slicing off the alpha channel
    # already yields BGR (what cv2 wants), so no cvtColor step is needed.
    shot = sct.grab(sct.monitors[0])
    frame = np.ascontiguousarray(np.asarray(shot)[:, :, :3])
    height, width = frame.shape[:2]
    scale = min(1.0, 1280 / width, 720 / height)
    if scale < 1.0:
        frame = cv2.resize(frame, (round(width * scale), round(height * scale)),
                           interpolation=cv2.INTER_AREA)
    return frame


def _grab_region(rect: Region) -> Image.Image:
    return ImageGrab.grab(bbox=rect, all_screens=True)


# Tunable constants for change detection -- see docs/replay-change-detection.md
# for how these were chosen and what they trade off.
_THUMB_SIZE = (160, 90)     # downscale target for diffing; cheap enough to run every captured frame
_PIXEL_THRESHOLD = 25       # per-pixel brightness delta (0-255) below this is sensor/compression noise
_TILE_GRID = (8, 8)         # columns x rows the thumbnail is split into for local scoring
_GLOBAL_MIN_SCORE = 0.02    # fraction of the whole thumbnail that must differ to count as a global change
_TILE_MIN_SCORE = 0.15      # fraction of a single tile that must differ -- catches small, localized changes
                            # (e.g. a toast) that a global fraction this small would never trip
_QUIET_FRAMES_TO_CLOSE = 2  # consecutive below-threshold frames before an in-progress event is finalized


class _ChangeTracker:
    """Turns a stream of captured frames into ChangeEvents: a run of
    consecutive above-threshold frames (e.g. every frame of a 500ms scroll,
    or a toast's appear-hold-disappear lifetime) is one event, not one event
    per frame -- see docs/replay-change-detection.md for why frame-level
    events were the wrong unit (they let a long scroll's sheer frame count
    dominate frame selection over a single brief, important change)."""

    def __init__(self) -> None:
        self._prev: np.ndarray | None = None
        self._active = False
        self._quiet_run = 0
        self._started_at = 0.0
        self._peak_at = 0.0
        self._peak_score = 0.0
        self._peak_bbox: tuple[int, int, int, int] = (0, 0, 0, 0)

    def observe(self, frame: np.ndarray, at: float) -> ChangeEvent | None:
        thumb = cv2.cvtColor(cv2.resize(frame, _THUMB_SIZE, interpolation=cv2.INTER_AREA),
                             cv2.COLOR_BGR2GRAY)
        prev, self._prev = self._prev, thumb
        if prev is None:
            return None
        mask = cv2.absdiff(prev, thumb) > _PIXEL_THRESHOLD
        height, width = frame.shape[:2]
        score, bbox = _score_and_bbox(mask, width, height)
        if score is not None:
            if not self._active:
                self._active = True
                self._started_at = at
                self._peak_at, self._peak_score, self._peak_bbox = at, score, bbox
            elif score > self._peak_score:
                self._peak_at, self._peak_score, self._peak_bbox = at, score, bbox
            self._quiet_run = 0
            return None
        if self._active:
            self._quiet_run += 1
            if self._quiet_run >= _QUIET_FRAMES_TO_CLOSE:
                event = ChangeEvent(self._started_at, self._peak_at, at, self._peak_score, self._peak_bbox)
                self._active = False
                return event
        return None


def _score_and_bbox(mask: np.ndarray, width: int, height: int
                     ) -> tuple[float | None, tuple[int, int, int, int] | None]:
    """None, None if nothing crossed either threshold. Otherwise a score and
    a bbox in the ORIGINAL frame's pixel coordinates (scaled up from the
    thumbnail). Tile hits take priority for the bbox: a small, concentrated
    change (a toast in one corner) should report a tight box around just
    that corner, not the whole-mask bounding box, which balloons out to
    cover unrelated noise elsewhere on screen (see docs/replay-change-detection.md)."""
    global_score = float(mask.mean())
    tiles_x, tiles_y = _TILE_GRID
    tile_h, tile_w = mask.shape[0] // tiles_y, mask.shape[1] // tiles_x
    hot_tiles = [(row, col) for row in range(tiles_y) for col in range(tiles_x)
                 if mask[row * tile_h:(row + 1) * tile_h, col * tile_w:(col + 1) * tile_w].mean()
                 >= _TILE_MIN_SCORE]
    if not hot_tiles and global_score < _GLOBAL_MIN_SCORE:
        return None, None
    scale_x, scale_y = width / mask.shape[1], height / mask.shape[0]
    if hot_tiles:
        rows, cols = zip(*hot_tiles)
        bbox = (min(cols) * tile_w * scale_x, min(rows) * tile_h * scale_y,
                (max(cols) + 1) * tile_w * scale_x, (max(rows) + 1) * tile_h * scale_y)
        return max(global_score, _TILE_MIN_SCORE), tuple(round(v) for v in bbox)
    ys, xs = np.nonzero(mask)
    bbox = (xs.min() * scale_x, ys.min() * scale_y, xs.max() * scale_x, ys.max() * scale_y)
    return global_score, tuple(round(v) for v in bbox)


def _select_notable_moments(segments: list[Segment], events: list[ChangeEvent], count: int
                             ) -> list[tuple[Segment, float | None]]:
    """Picks up to `count` (segment, target_timestamp) pairs to extract a
    frame from. target_timestamp of None means "no specific moment, use the
    segment's own midpoint" (the old behavior, still the fallback here).

    Fills slots with the highest-scoring events first -- the same segment
    can be picked more than once if it holds two distinct notable moments
    (e.g. a toast's appearance and its disappearance both landing in one
    1-second segment), which is why this returns a flat list of pairs rather
    than a dict keyed by segment. The window's first and last segment are
    then guaranteed a slot each (start/end state for context) UNLESS an
    event already picked that exact segment -- forcing a redundant
    None-target entry on top of an already-picked event would waste a slot
    and silently downgrade that segment's frame from "the notable moment"
    back to "just the midpoint". Any slots still empty after that (a quiet
    window with few or no events) are filled by the old even-spacing logic
    so this never regresses below current coverage."""
    by_time = sorted(segments, key=lambda item: item.started)

    def segment_for(at: float) -> Segment | None:
        return next((item for item in by_time if item.started <= at <= item.ended), None)

    picks: list[tuple[Segment, float]] = []
    seen: set[tuple[Path, float]] = set()
    picked_paths: set[Path] = set()
    for event in sorted(events, key=lambda item: item.peak_score, reverse=True):
        segment = segment_for(event.peak_at)
        if segment is None:
            continue
        key = (segment.path, round(event.peak_at, 1))
        if key in seen:
            continue
        seen.add(key)
        picked_paths.add(segment.path)
        picks.append((segment, event.peak_at))
        if len(picks) >= max(0, count - 2):
            break

    result: list[tuple[Segment, float | None]] = list(picks)
    for boundary in (by_time[0], by_time[-1]):
        if boundary.path not in picked_paths:
            result.append((boundary, None))
            picked_paths.add(boundary.path)
    if len(result) < count:
        remaining = [item for item in by_time if item.path not in picked_paths]
        for segment in _evenly_spaced(remaining, count - len(result)):
            result.append((segment, None))
            picked_paths.add(segment.path)
    result.sort(key=lambda item: item[1] if item[1] is not None else item[0].started)
    return result[:count]


def _frame_index_for(segment: Segment, target_at: float | None, frame_count: int) -> int:
    """Maps a wall-clock timestamp within `segment` to a 0-based frame index
    in its video file. _record_segment writes frame i at roughly
    started + i*interval and stops once the 1-second deadline is hit -- so
    for a 10-frame/10fps segment, frames land at +0.0s, +0.1s, ..., +0.9s,
    NOT spread across the full [started, ended] span (`ended` is captured
    slightly after that last write, so the true frame cadence is
    (ended-started)/frame_count, not /(frame_count-1) -- using the latter
    was measured to be off by a full frame: a 0.6-fraction target landed on
    index 5 instead of the correct 6). None (no specific moment picked)
    keeps the old behavior of just grabbing the segment's midpoint frame."""
    if target_at is None or segment.ended <= segment.started or frame_count <= 0:
        return max(0, frame_count // 2)
    fraction = (target_at - segment.started) / (segment.ended - segment.started)
    fraction = max(0.0, min(1.0, fraction))
    return min(frame_count - 1, int(fraction * frame_count))


def _evenly_spaced(items: list[Segment], count: int) -> list[Segment]:
    if count <= 0:
        return []
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
