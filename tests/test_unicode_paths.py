import shutil
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from airpointer.screen_buffer import ScreenReplayBuffer, Segment


@contextmanager
def _korean_tmp_dir():
    """A fresh absolute directory whose path contains non-ASCII (Korean)
    characters, regardless of where this repo happens to be checked out --
    reproduces the cv2.imwrite bug (see docs/replay-change-detection.md)
    independently of this machine's own folder names."""
    root = Path(tempfile.mkdtemp(prefix="에어포인터-테스트-"))
    try:
        yield root
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _assert_valid_png(path: Path, expected_size: tuple[int, int]) -> None:
    assert path.exists() and path.stat().st_size > 0
    with Image.open(path) as image:
        image.verify()
    with Image.open(path) as image:
        assert image.size == expected_size


def test_capture_still_writes_a_real_png_under_a_non_ascii_absolute_path() -> None:
    with _korean_tmp_dir() as root:
        grabbed = np.full((90, 120, 3), 77, dtype=np.uint8)
        buffer = ScreenReplayBuffer(lambda: 60, lambda: 5, root / "replay", grab=lambda: grabbed)

        path, = buffer.capture_still()

        _assert_valid_png(path, (120, 90))


def test_export_recent_writes_real_pngs_under_a_non_ascii_absolute_path() -> None:
    with _korean_tmp_dir() as root:
        buffer = ScreenReplayBuffer(lambda: 60, lambda: 5, root / "replay")
        buffer.root.mkdir(parents=True, exist_ok=True)
        now = time.time()
        segment_path = buffer.root / "segment.mp4"
        width, height, fps = 120, 90, 5
        writer = cv2.VideoWriter(str(segment_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
        frame = np.full((height, width, 3), 150, dtype=np.uint8)
        for _ in range(fps):
            writer.write(frame)
        writer.release()
        buffer._segments.append(
            Segment(segment_path, started=now - 1.0, ended=now, size=segment_path.stat().st_size))

        paths = buffer.export_recent(seconds=5, frame_count=1)

        assert len(paths) == 1
        _assert_valid_png(paths[0], (width, height))
