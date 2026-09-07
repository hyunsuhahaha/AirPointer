from __future__ import annotations

import json
import os
import shutil
import sys
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
    # Fraction of the WHOLE thumbnail that differed at the peak moment (mask.mean(),
    # never clamped up by the tile floor the way peak_score can be -- see
    # _score_and_bbox) -- a toast can score high via the tile threshold while
    # its extent stays tiny (a scroll's is the opposite: high on both). Used
    # by _select_events_diverse() to guarantee small/localized changes a slot
    # even when broader changes would otherwise out-rank them every time on
    # peak_score alone -- see docs/replay-change-detection.md.
    extent: float = 0.0
    # Resolved via UI Automation at event-CLOSE time (see _ChangeTracker.observe),
    # not later at export_recent() time -- by the time a replay is actually
    # sent, the real moment this bbox came from can be tens of seconds in the
    # past, and the screen may have moved on to something else entirely at
    # that same location. None if no named element was found there (falls
    # back to _bbox_label's quadrant phrase).
    element_label: str | None = None


@dataclass(frozen=True, slots=True)
class BufferStatus:
    running: bool
    seconds: float
    size_bytes: int
    error: str = ""


# How long a manifest.json (see write_manifest) and the segments copied
# alongside it are kept in the dispatch folder before _prune()'s sweep
# deletes them -- deliberately longer than the live buffer's own
# retention_seconds (default 180s), since the whole point is letting Codex
# query past that window. Same "reasonable starting point, not measured"
# status as every other constant here.
_MANIFEST_TTL_SECONDS = 600
# The sweep walks every dispatch subfolder looking for a manifest.json, so
# it's throttled independently of _prune()'s own per-frame cadence rather
# than running on every single call.
_MANIFEST_SWEEP_INTERVAL_SECONDS = 60


class ScreenReplayBuffer:
    """Owns screen capture, bounded segment storage, and recent-frame export."""

    def __init__(self, retention_seconds: Callable[[], int], fps: Callable[[], int],
                 root: Path | None = None, max_bytes: int = 250 * 1024 * 1024,
                 grab: Callable[[], np.ndarray] | None = None,
                 grab_region: Callable[[Region], Image.Image] | None = None,
                 element_label: Callable[[tuple[int, int, int, int], int, int], str | None] | None = None
                 ) -> None:
        local = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        self.root = (root or local / "AirPointer" / "replay").resolve()
        self.dispatch = self.root.parent / "dispatch"
        self.retention_seconds = retention_seconds
        self.fps = fps
        self.max_bytes = max_bytes
        self._grab = grab or _grab_screen
        self._grab_region = grab_region or _grab_region
        # Real implementation resolves a detected-change bbox to a named UI
        # element via Windows UI Automation (see _bbox_element_label);
        # injectable so tests can force the quadrant-label fallback path
        # deterministically instead of querying whatever's really on screen.
        self._element_label = element_label or _bbox_element_label
        self._segments: deque[Segment] = deque()
        # maxlen is a hard memory backstop, not the normal pruning path --
        # _prune() drops events past retention_seconds the same as segments,
        # this just guarantees the deque can never grow unbounded if pruning
        # ever falls behind (e.g. a very bursty change rate).
        self._events: deque[ChangeEvent] = deque(maxlen=512)
        # (epoch time, tile-diff score) per captured frame -- feeds the
        # browser's live "TILE DIFF SCORE" chart (see recent_scores() and
        # companion_bridge.py's publish_scores()). maxlen is the same kind of
        # hard backstop as _events' above, sized generously past the UI's
        # widest window (5 min at a very optimistic 30fps) so normal pruning
        # in _prune() is what actually bounds this in practice.
        self._scores: deque[tuple[float, float]] = deque(maxlen=9000)
        self._last_manifest_sweep = 0.0
        self._change_tracker = _ChangeTracker(self._element_label)
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
        self._change_tracker = _ChangeTracker(self._element_label)
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
            self._scores.clear()
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

    def recent_scores(self, seconds: int) -> list[tuple[float, float]]:
        """Real per-frame tile-diff scores from _ChangeTracker.observe(),
        (epoch time, score) pairs from the last `seconds`. Feeds the
        browser's live TILE DIFF SCORE chart via companion_bridge.py's
        publish_scores() -- see main.py's _redraw()."""
        cutoff = time.time() - max(1, int(seconds))
        with self._lock:
            return [item for item in self._scores if item[0] >= cutoff]

    def capture_still(self) -> tuple[Path, ...]:
        self.dispatch.mkdir(parents=True, exist_ok=True)
        path = self.dispatch / f"screenshot-{uuid.uuid4().hex}.png"
        if not _imwrite(path, self._grab()):
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

    def export_recent(self, seconds: int, frame_count: int = 6, with_manifest: bool = False) -> tuple[Path, ...]:
        triggered_at = time.time()
        cutoff = triggered_at - max(1, seconds)
        paths: list[Path] = []
        captured_at: dict[str, float] = {}
        regions: dict[str, str] = {}
        with self._lock:
            segments = [item for item in self._segments if item.ended >= cutoff and item.path.exists()]
            if not segments:
                raise RuntimeError("Replay buffer is not ready yet")
            events = [event for event in self._events if event.peak_at >= cutoff]
            picks = _select_notable_moments(segments, events, min(frame_count, len(segments)))
            folder = self.dispatch / uuid.uuid4().hex
            folder.mkdir(parents=True, exist_ok=True)
            if with_manifest:
                # Copies (not pins-in-place) the window's own segments into
                # this per-capture dispatch folder, which the live buffer's
                # own _prune() never sweeps -- so Codex can still query an
                # arbitrary offset within this window minutes later, well
                # past retention_seconds, without needing new bookkeeping in
                # the live buffer itself. See docs/replay-change-detection.md.
                write_manifest(folder, triggered_at, segments)
            for index, (segment, target_at, bbox, element_label) in enumerate(picks, 1):
                capture = cv2.VideoCapture(str(segment.path))
                try:
                    count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
                    capture.set(cv2.CAP_PROP_POS_FRAMES, _frame_index_for(segment, target_at, count))
                    ok, frame = capture.read()
                finally:
                    capture.release()
                if ok:
                    path = folder / f"frame-{index:02d}.png"
                    if _imwrite(path, frame):
                        paths.append(path)
                        # None (no notable event, fell back to the segment's
                        # midpoint frame -- see _frame_index_for) means this
                        # picked frame's real moment is the segment's own
                        # midpoint, not "right now".
                        captured_at[path.name] = target_at if target_at is not None else (segment.started + segment.ended) / 2
                        if bbox is not None:
                            # element_label was already resolved by
                            # _ChangeTracker at the moment the change was
                            # detected (see ChangeEvent.element_label) --
                            # not re-queried here, which would be querying
                            # the CURRENT screen for a possibly long-past
                            # moment.
                            regions[path.name] = element_label or _bbox_label(bbox, frame.shape[1], frame.shape[0])
        if not paths:
            shutil.rmtree(folder, ignore_errors=True)
            raise RuntimeError("Could not extract replay frames")
        # Sidecar, not a return-type change: callers all the way through
        # CaptureController/codex_delivery only ever want "a tuple of image
        # paths" and shouldn't need to unpack a richer type just to attach
        # them or clean them up. Only main.App._publish_sent_frames (mirroring
        # a send into the browser's timeline, which needs "how long ago was
        # this") reads this file -- and deletes it once it has, so
        # cleanup_paths()'s rmdir() of the now-empty folder still works.
        (folder / "frame-times.json").write_text(json.dumps(captured_at), encoding="utf-8")
        # Second sidecar, only written when at least one picked frame came
        # from an actual ChangeEvent (ordinary evenly-spaced/boundary frames
        # have no bbox and are never worth mentioning) -- read once and
        # deleted by read_and_clear_region_hint() *before* the capture is
        # sent, unlike frame-times.json above which survives until after
        # send (on_sent still needs it then).
        if regions:
            (folder / "frame-regions.json").write_text(json.dumps(regions), encoding="utf-8")
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
                captured_at = time.time()
                event = self._change_tracker.observe(frame, captured_at)
                with self._lock:
                    self._scores.append((captured_at, self._change_tracker.last_score))
                    if event is not None:
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
            while self._scores and self._scores[0][0] < cutoff:
                self._scores.popleft()
        for item in expired:
            item.path.unlink(missing_ok=True)
        if now - self._last_manifest_sweep >= _MANIFEST_SWEEP_INTERVAL_SECONDS:
            self._last_manifest_sweep = now
            self._sweep_expired_manifests(now)

    def _sweep_expired_manifests(self, now: float) -> None:
        """Deletes dispatch subfolders whose manifest.json (see
        write_manifest) is older than _MANIFEST_TTL_SECONDS -- these outlive
        a normal capture's cleanup_paths() call on purpose (see
        read_manifest_hint), so something has to eventually reclaim them."""
        if not self.dispatch.exists():
            return
        for child in self.dispatch.iterdir():
            if not child.is_dir():
                continue
            manifest_path = child / "manifest.json"
            try:
                created_at = json.loads(manifest_path.read_text(encoding="utf-8")).get("createdAt")
            except (OSError, ValueError):
                continue
            if isinstance(created_at, (int, float)) and now - created_at > _MANIFEST_TTL_SECONDS:
                shutil.rmtree(child, ignore_errors=True)

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


def _imwrite(path: Path, frame: np.ndarray) -> bool:
    """cv2.imwrite(str(path), frame) silently returns False (no exception)
    for an absolute Windows path containing non-ASCII characters -- this
    repo's own path (OneDrive\\문서\\...) reproduces it, and it would equally
    bite any user whose Windows account name or %LOCALAPPDATA% has
    non-ASCII characters (ScreenReplayBuffer.root/dispatch are always
    resolved to absolute paths). cv2.VideoWriter/VideoCapture do not have
    this problem -- only the image codec path does. Encoding in memory with
    cv2.imencode and writing the bytes through Path.write_bytes (Python's
    own file I/O, which handles Unicode paths correctly on Windows)
    sidesteps OpenCV's file writer entirely. Keeps imwrite's bool-return
    contract (never raises) so both call sites' existing
    success/failure handling still applies unchanged."""
    ok, encoded = cv2.imencode(path.suffix or ".png", frame)
    if not ok:
        return False
    try:
        path.write_bytes(encoded.tobytes())
    except OSError:
        return False
    return True


# Tunable constants for change detection -- see docs/replay-change-detection.md
# for how these were chosen and what they trade off.
_THUMB_SIZE = (160, 90)     # downscale target for diffing; cheap enough to run every captured frame
_PIXEL_THRESHOLD = 25       # per-pixel brightness delta (0-255) below this is sensor/compression noise
_TILE_GRID = (8, 8)         # columns x rows the thumbnail is split into for local scoring
_GLOBAL_MIN_SCORE = 0.02    # fraction of the whole thumbnail that must differ to count as a global change
_TILE_MIN_SCORE = 0.15      # fraction of a single tile that must differ -- catches small, localized changes
                            # (e.g. a toast) that a global fraction this small would never trip
_QUIET_FRAMES_TO_CLOSE = 2  # consecutive below-threshold frames before an in-progress event is finalized
_REDUNDANCY_LAMBDA = 0.7    # how hard an overlapping-bbox event gets penalized in _select_events_diverse
                            # (1.0 = a fully-overlapping repeat scores 0; 0.0 = pure top-score, no diversity)
_LOCALIZED_EXTENT_MAX = 0.05  # extent below this counts as "localized" (a toast/dialog, not a scroll) for
                              # the guaranteed-slot floor in _select_events_diverse


class _ChangeTracker:
    """Turns a stream of captured frames into ChangeEvents: a run of
    consecutive above-threshold frames (e.g. every frame of a 500ms scroll,
    or a toast's appear-hold-disappear lifetime) is one event, not one event
    per frame -- see docs/replay-change-detection.md for why frame-level
    events were the wrong unit (they let a long scroll's sheer frame count
    dominate frame selection over a single brief, important change)."""

    def __init__(self, element_label: Callable[[tuple[int, int, int, int], int, int], str | None] | None = None
                 ) -> None:
        self._prev: np.ndarray | None = None
        self._active = False
        self._quiet_run = 0
        self._started_at = 0.0
        self._peak_at = 0.0
        self._peak_score = 0.0
        self._peak_bbox: tuple[int, int, int, int] = (0, 0, 0, 0)
        self._peak_extent: float = 0.0
        # This frame's raw global diff score (mask.mean()), regardless of
        # whether it crossed either threshold -- unlike peak_score above,
        # which only ever holds an in-progress/just-closed event's peak.
        # Read by ScreenReplayBuffer right after each observe() call for the
        # live score chart; stays 0.0 until the second frame (the first has
        # no _prev to diff against).
        self.last_score: float = 0.0
        # Real implementation queries UI Automation; injectable so tests
        # don't hit the real screen (see ScreenReplayBuffer.__init__, which
        # passes its own element_label through here).
        self._element_label = element_label or _bbox_element_label

    def observe(self, frame: np.ndarray, at: float) -> ChangeEvent | None:
        thumb = cv2.cvtColor(cv2.resize(frame, _THUMB_SIZE, interpolation=cv2.INTER_AREA),
                             cv2.COLOR_BGR2GRAY)
        prev, self._prev = self._prev, thumb
        if prev is None:
            return None
        mask = cv2.absdiff(prev, thumb) > _PIXEL_THRESHOLD
        self.last_score = float(mask.mean())
        height, width = frame.shape[:2]
        score, bbox, extent = _score_and_bbox(mask, width, height)
        if score is not None:
            if not self._active:
                self._active = True
                self._started_at = at
                self._peak_at, self._peak_score, self._peak_bbox, self._peak_extent = at, score, bbox, extent
            elif score > self._peak_score:
                self._peak_at, self._peak_score, self._peak_bbox, self._peak_extent = at, score, bbox, extent
            self._quiet_run = 0
            return None
        if self._active:
            self._quiet_run += 1
            if self._quiet_run >= _QUIET_FRAMES_TO_CLOSE:
                # Resolved NOW, moments after the real change (not later at
                # export_recent() time, when the screen may have moved on --
                # see ChangeEvent.element_label). height/width are this
                # closing frame's own dimensions, which is the frame this
                # bbox's coordinates were computed against (_score_and_bbox
                # scales up from the thumbnail using whatever width/height
                # observe() was called with).
                label = self._element_label(self._peak_bbox, width, height)
                event = ChangeEvent(started_at=self._started_at, peak_at=self._peak_at, ended_at=at,
                                     peak_score=self._peak_score, bbox=self._peak_bbox,
                                     extent=self._peak_extent, element_label=label)
                self._active = False
                return event
        return None


def _score_and_bbox(mask: np.ndarray, width: int, height: int
                     ) -> tuple[float | None, tuple[int, int, int, int] | None, float]:
    """None, None, extent if nothing crossed either threshold (extent is
    still the real global_score even on a reject -- callers that only care
    about score/bbox already treat None as "no event" and never look at it).
    Otherwise a score and a bbox in the ORIGINAL frame's pixel coordinates
    (scaled up from the thumbnail), plus extent (see ChangeEvent.extent).
    Tile hits take priority for the bbox: a small, concentrated change (a
    toast in one corner) should report a tight box around just that corner,
    not the whole-mask bounding box, which balloons out to cover unrelated
    noise elsewhere on screen (see docs/replay-change-detection.md)."""
    global_score = float(mask.mean())
    tiles_x, tiles_y = _TILE_GRID
    tile_h, tile_w = mask.shape[0] // tiles_y, mask.shape[1] // tiles_x
    hot_tiles = [(row, col) for row in range(tiles_y) for col in range(tiles_x)
                 if mask[row * tile_h:(row + 1) * tile_h, col * tile_w:(col + 1) * tile_w].mean()
                 >= _TILE_MIN_SCORE]
    if not hot_tiles and global_score < _GLOBAL_MIN_SCORE:
        return None, None, global_score
    scale_x, scale_y = width / mask.shape[1], height / mask.shape[0]
    if hot_tiles:
        rows, cols = zip(*hot_tiles)
        bbox = (min(cols) * tile_w * scale_x, min(rows) * tile_h * scale_y,
                (max(cols) + 1) * tile_w * scale_x, (max(rows) + 1) * tile_h * scale_y)
        return max(global_score, _TILE_MIN_SCORE), tuple(round(v) for v in bbox), global_score
    ys, xs = np.nonzero(mask)
    bbox = (xs.min() * scale_x, ys.min() * scale_y, xs.max() * scale_x, ys.max() * scale_y)
    return global_score, tuple(round(v) for v in bbox), global_score


def _bbox_iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    """Intersection-over-union of two (left, top, right, bottom) boxes, 0.0
    if they don't overlap at all. Used as a cheap, already-available proxy
    for "are these two events actually the same ongoing thing" -- no new
    per-frame computation needed, since bbox is computed anyway."""
    left, top = max(a[0], b[0]), max(a[1], b[1])
    right, bottom = min(a[2], b[2]), min(a[3], b[3])
    if right <= left or bottom <= top:
        return 0.0
    intersection = (right - left) * (bottom - top)
    area_a = max(0, a[2] - a[0]) * max(0, a[3] - a[1])
    area_b = max(0, b[2] - b[0]) * max(0, b[3] - b[1])
    union = area_a + area_b - intersection
    return intersection / union if union > 0 else 0.0


def _select_events_diverse(events: list[ChangeEvent], budget: int) -> list[ChangeEvent]:
    """Greedy MMR (Maximal Marginal Relevance) selection: at each step, picks
    the event maximizing peak_score * (1 - _REDUNDANCY_LAMBDA * overlap with
    whatever's already been picked). Plain top-K-by-score lets several
    near-duplicate large events (three segments of the same long scroll, say)
    dominate every slot just because each one individually outscores a
    smaller, differently-located event -- once the first is picked, later
    ones that overlap its bbox get penalized, leaving room for the rest.

    Then applies a floor: if nothing picked so far is "localized" (extent <
    _LOCALIZED_EXTENT_MAX -- a toast/dialog, not a scroll/window-switch) but
    at least one such event exists among the candidates, the weakest current
    pick is swapped out for the best localized one (or just appended, if
    there's still room in the budget). Without this, a busy window full of
    several distinct broad changes could still MMR its way through the whole
    budget on score alone, with a low-scoring toast never winning a slot on
    its own merits -- this guarantees it isn't invisible to the algorithm
    just because it's quiet. See docs/replay-change-detection.md."""
    remaining = list(events)
    picked: list[ChangeEvent] = []
    while remaining and len(picked) < budget:
        def effective(event: ChangeEvent) -> float:
            redundancy = max((_bbox_iou(event.bbox, other.bbox) for other in picked), default=0.0)
            return event.peak_score * (1 - _REDUNDANCY_LAMBDA * redundancy)
        best = max(remaining, key=effective)
        picked.append(best)
        remaining.remove(best)

    if budget > 0 and not any(event.extent < _LOCALIZED_EXTENT_MAX for event in picked):
        localized = [event for event in events if event.extent < _LOCALIZED_EXTENT_MAX and event not in picked]
        if localized:
            best_localized = max(localized, key=lambda event: event.peak_score)
            if len(picked) < budget:
                picked.append(best_localized)
            else:
                weakest = min(range(len(picked)), key=lambda index: picked[index].peak_score)
                picked[weakest] = best_localized

    return picked


def _select_notable_moments(segments: list[Segment], events: list[ChangeEvent], count: int
                             ) -> list[tuple[Segment, float | None, tuple[int, int, int, int] | None, str | None]]:
    """Picks up to `count` (segment, target_timestamp, bbox, element_label)
    quadruples to extract a frame from. target_timestamp of None means "no
    specific moment, use the segment's own midpoint" (the old behavior,
    still the fallback here); bbox and element_label are None exactly when
    target_timestamp is (a boundary/evenly-spaced pick has no event behind
    it to report a region for). element_label carries through whatever
    ChangeEvent.element_label already resolved at event-close time (see
    _ChangeTracker.observe) -- this function does no UI Automation querying
    of its own.

    Fills slots via _select_events_diverse() -- highest-scoring events first,
    but penalized for overlapping an already-picked event's bbox (so three
    near-duplicate scroll events don't crowd out one small, differently-located
    toast) and with a floor guarantee for the best localized (small-extent)
    event even when broader changes would otherwise out-rank it on raw score
    alone every time -- see docs/replay-change-detection.md. The same segment
    can still be picked more than once if it holds two distinct notable
    moments (e.g. a toast's appearance and its disappearance both landing in
    one 1-second segment), which is why this returns a flat list of
    quadruples rather than a dict keyed by segment. The window's first and
    last segment are then guaranteed a slot each (start/end state for
    context) UNLESS an event already picked that exact segment -- forcing a
    redundant None-target entry on top of an already-picked event would waste
    a slot and silently downgrade that segment's frame from "the notable
    moment" back to "just the midpoint". Any slots still empty after that (a
    quiet window with few or no events) are filled by the old even-spacing
    logic so this never regresses below current coverage."""
    by_time = sorted(segments, key=lambda item: item.started)

    def segment_for(at: float) -> Segment | None:
        return next((item for item in by_time if item.started <= at <= item.ended), None)

    candidates: list[ChangeEvent] = []
    event_segment: dict[ChangeEvent, Segment] = {}
    seen: set[tuple[Path, float]] = set()
    for event in events:
        segment = segment_for(event.peak_at)
        if segment is None:
            continue
        key = (segment.path, round(event.peak_at, 1))
        if key in seen:
            continue
        seen.add(key)
        event_segment[event] = segment
        candidates.append(event)

    # max(1, ...) not max(0, ...): even a tiny/zero count still gets one
    # event-based pick through if any candidate exists -- matches the old
    # loop's actual behavior (its break check ran right after appending, so
    # it always let the first append through before ever comparing against
    # the budget). The final result[:count] slice below is what actually
    # enforces the real cap either way.
    chosen = _select_events_diverse(candidates, max(1, count - 2))
    picks = [(event_segment[event], event.peak_at, event.bbox, event.element_label) for event in chosen]
    picked_paths = {segment.path for segment, *_ in picks}

    result: list[tuple[Segment, float | None, tuple[int, int, int, int] | None, str | None]] = list(picks)
    for boundary in (by_time[0], by_time[-1]):
        if boundary.path not in picked_paths:
            result.append((boundary, None, None, None))
            picked_paths.add(boundary.path)
    if len(result) < count:
        remaining = [item for item in by_time if item.path not in picked_paths]
        for segment in _evenly_spaced(remaining, count - len(result)):
            result.append((segment, None, None, None))
            picked_paths.add(segment.path)
    result.sort(key=lambda item: item[1] if item[1] is not None else item[0].started)
    return result[:count]


def _frame_to_screen_point(bbox: tuple[int, int, int, int], frame_width: int, frame_height: int
                            ) -> tuple[int, int] | None:
    """Maps a bbox center from the recorded frame's own pixel space (already
    downscaled by _grab_screen's 1280x720 cap) back to real screen pixel
    coordinates. Re-derives the scale from the CURRENT monitor size and the
    frame's own dimensions rather than replaying _grab_screen's exact
    formula, so this stays correct even if that formula changes later or
    the monitor was reconfigured between recording and export. This process
    is per-monitor-DPI-aware (see airpointer_launcher._make_dpi_aware), so
    the result lines up with what UI Automation expects without further
    conversion. Returns None if the monitor geometry can't be read."""
    if frame_width <= 0 or frame_height <= 0:
        return None
    try:
        monitor = _get_sct().monitors[0]
    except Exception:
        return None
    mon_width, mon_height = monitor.get("width", 0), monitor.get("height", 0)
    if mon_width <= 0 or mon_height <= 0:
        return None
    left, top, right, bottom = bbox
    cx, cy = (left + right) / 2, (top + bottom) / 2
    scale_x, scale_y = frame_width / mon_width, frame_height / mon_height
    return (monitor["left"] + round(cx / scale_x), monitor["top"] + round(cy / scale_y))


def _frame_to_screen_rect(bbox: tuple[int, int, int, int], frame_width: int, frame_height: int
                           ) -> tuple[int, int, int, int] | None:
    """Same frame-to-screen mapping as _frame_to_screen_point, kept as a
    separate function rather than deriving a rect from that one's point:
    the OCR fallback below needs the actual rectangle to crop (see
    ocr_fallback.text_label_at), not just its center. Returns None under
    the exact same conditions as _frame_to_screen_point (degenerate frame
    size or unreadable monitor geometry)."""
    if frame_width <= 0 or frame_height <= 0:
        return None
    try:
        monitor = _get_sct().monitors[0]
    except Exception:
        return None
    mon_width, mon_height = monitor.get("width", 0), monitor.get("height", 0)
    if mon_width <= 0 or mon_height <= 0:
        return None
    left, top, right, bottom = bbox
    scale_x, scale_y = frame_width / mon_width, frame_height / mon_height
    return (monitor["left"] + round(left / scale_x), monitor["top"] + round(top / scale_y),
            monitor["left"] + round(right / scale_x), monitor["top"] + round(bottom / scale_y))


_ELEMENT_LABEL_RETRY_DELAY = 0.25  # seconds -- see the retry comment below


def _bbox_element_label(bbox: tuple[int, int, int, int], width: int, height: int) -> str | None:
    """Best-effort upgrade of _bbox_label(): resolves the bbox center to a
    real UI element (e.g. "저장 버튼") via Windows UI Automation -- the same
    mechanism selection_context.py already uses to read selected text --
    instead of only a screen quadrant. Returns None on ANY failure (no
    screen point, off-Windows, COM not ready, no element, unnamed element,
    AND the OCR fallback below also finding nothing) so callers always have
    _bbox_label() to fall back to; this must never block a capture.

    Retries ONCE, after a short fixed delay, if the first attempt finds
    nothing. Confirmed by hand against a freshly launched Notepad window:
    querying the instant a window's change is detected can land before
    Windows has finished exposing that window to UI Automation, and the
    exact same point resolves correctly a beat later. This costs nothing
    in the common case -- an element that was already on screen (a toast
    inside an existing app, a scroll, a text edit) resolves on the first
    try -- the delay only ever happens for the rarer "something brand new
    just appeared" case that actually needs it.

    If UI Automation still finds nothing after that retry (some apps never
    expose an accessibility tree at all -- games, custom-rendered/canvas
    UI, remote desktop clients), falls back once more to reading the
    region's pixels via OCR (ocr_fallback.text_label_at) before giving up
    -- see docs/replay-change-detection.md's "OCR 폴백" section."""
    point = _frame_to_screen_point(bbox, width, height)
    if point is None:
        return None
    try:
        from .selection_context import element_label_at
        label = element_label_at(*point)
        if label is None:
            time.sleep(_ELEMENT_LABEL_RETRY_DELAY)
            label = element_label_at(*point)
        if label is not None:
            return label
    except Exception:
        pass
    rect = _frame_to_screen_rect(bbox, width, height)
    if rect is None:
        return None
    try:
        from .ocr_fallback import text_label_at
        return text_label_at(rect)
    except Exception:
        return None


def _bbox_label(bbox: tuple[int, int, int, int], width: int, height: int) -> str:
    """Turns a change bbox into a short Korean position phrase (e.g. "오른쪽
    아래") for the agent prompt. A coarse 3x3 grid, not exact coordinates --
    the prompt only needs to point attention at roughly the right part of
    the image, not reproduce the bbox."""
    if width <= 0 or height <= 0:
        return "가운데"
    left, top, right, bottom = bbox
    cx, cy = (left + right) / 2, (top + bottom) / 2
    col = "왼쪽" if cx < width / 3 else "오른쪽" if cx > width * 2 / 3 else ""
    row = "위" if cy < height / 3 else "아래" if cy > height * 2 / 3 else ""
    if col and row:
        return f"{col} {row}"
    return col or row or "가운데"


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


def read_and_clear_region_hint(paths: tuple[Path, ...]) -> str:
    """Reads the per-frame notable-region labels export_recent() may have
    dropped alongside replay frames (frame-regions.json) and turns them into
    one line per notable frame for the agent prompt, e.g. "화면 변화 감지:
    2번째 프레임, 오른쪽 아래 영역". Must run BEFORE the capture is sent (unlike
    frame-times.json, which main.py only needs after send, for the browser
    mirror) -- deletes the sidecar immediately after reading so it never
    blocks cleanup_paths()'s rmdir() of the now-empty folder. Returns ""
    for screenshot/region captures (no sidecar) and replay exports with no
    notable frames, so callers can always just append the result."""
    if not paths:
        return ""
    sidecar = paths[0].parent / "frame-regions.json"
    try:
        regions: dict[str, str] = json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    finally:
        sidecar.unlink(missing_ok=True)
    if not regions:
        return ""
    order = {path.name: index for index, path in enumerate(paths, 1)}
    lines = [f"화면 변화 감지: {order[name]}번째 프레임, {label} 영역"
             for name, label in regions.items() if name in order]
    return "\n".join(lines)


def _replay_query_command_example() -> str:
    """The exact command Codex should run to query an extra frame, folded
    into manifest.json's frameQuery.description. Reuses whatever's already
    running: sys.executable IS AirPointer.exe itself under PyInstaller (no
    separate build target needed for this), or the live `python
    airpointer_launcher.py` in a source checkout -- either way the same
    --replay-frame branch in airpointer_launcher.main() handles it."""
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}" --replay-frame "<manifest.json>" -0.5'
    launcher = Path(__file__).resolve().parent.parent / "airpointer_launcher.py"
    return f'python "{launcher}" --replay-frame "<manifest.json>" -0.5'


def write_manifest(folder: Path, triggered_at: float, segments: list[Segment]) -> Path:
    """Copies `segments`' own video files into folder/segments/ (so Codex can
    still query them well past retention_seconds -- see export_recent()'s
    with_manifest, which is why this copies instead of pinning them in place)
    and writes folder/manifest.json describing them for replay_query.py's
    query_frame() to seek into later.

    Unlike every other sidecar in this file, this one is NOT read-and-cleared
    right before/after send (see read_manifest_hint below) -- it has to
    survive as long as the conversation might still want to query it, however
    long that turns out to be (see _MANIFEST_TTL_SECONDS and the sweep in
    _prune() for when it finally gets cleaned up)."""
    segments_dir = folder / "segments"
    segments_dir.mkdir(parents=True, exist_ok=True)
    copied: list[dict[str, object]] = []
    for segment in segments:
        dest = segments_dir / segment.path.name
        try:
            shutil.copy2(segment.path, dest)
        except OSError:
            continue
        copied.append({"path": str(dest), "startedAt": segment.started, "endedAt": segment.ended})
    manifest_path = folder / "manifest.json"
    manifest_path.write_text(json.dumps({
        "version": 1,
        "createdAt": time.time(),
        "triggeredAt": triggered_at,
        # All epoch-seconds floats throughout (Python's own time.time() unit) --
        # this manifest is only ever read by replay_query.py, not the web
        # app's own (millisecond-based) equivalent, so there's no format to match.
        "segments": copied,
        "frameQuery": {
            "command": _replay_query_command_example(),
            "description": ("지금 보낸 화면 전후로 놓친 순간이 있으면, 위 명령의 마지막 숫자를 "
                            "원하는 상대 초(음수=이전 화면, 예: -0.5는 0.5초 전)로 바꿔 실행해 보세요. "
                            "여러 시점을 한 번에 조회할 수도 있습니다(숫자를 더 붙이면 됨). "
                            "출력된 이미지 경로를 view_image로 열어보세요."),
        },
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest_path


def read_manifest_hint(paths: tuple[Path, ...]) -> str:
    """Like read_and_clear_region_hint, but for manifest.json -- and does NOT
    delete it (see write_manifest's docstring for why). Returns "" when no
    manifest was written (screenshot/region captures, Claude Desktop target,
    or a replay export() call that didn't ask for with_manifest)."""
    if not paths:
        return ""
    manifest_path = paths[0].parent / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    query = manifest.get("frameQuery") if isinstance(manifest, dict) else None
    if not isinstance(query, dict) or not query.get("command"):
        return ""
    return f"다른 시점 조회: {query['command']}\n{query.get('description', '')}".rstrip()


def cleanup_paths(paths: tuple[Path, ...]) -> None:
    parents = {path.parent for path in paths}
    for path in paths:
        path.unlink(missing_ok=True)
    for parent in parents:
        try:
            parent.rmdir()
        except OSError:
            pass
