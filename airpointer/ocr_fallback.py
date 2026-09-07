"""Last-resort text label for a detected-change region when Windows UI
Automation exposes nothing there (see _bbox_element_label in
screen_buffer.py). Some apps never populate the accessibility tree UIA
walks -- games, custom-rendered/canvas UI, remote desktop clients -- so
ElementFromPoint finds no named control there no matter how long you wait
(see docs/replay-change-detection.md's "위치 힌트를 3x3 격자에서 실제 UI 요소
이름으로" section for that limitation being called out originally). This
module reads the pixels themselves instead: crop the screen region the
change happened in and run Windows' own on-device OCR (Windows.Media.Ocr,
via the winsdk projection) over it.

Same "best effort, never raises, None on any failure" contract as
selection_context.py -- a missing OCR language pack, a monitor that
vanished mid-query, or winsdk itself not being importable must never block
a capture; callers always have the coarse quadrant label
(screen_buffer._bbox_label) to fall back to.

The OcrEngine is created once per process and cached at module level --
see docs/replay-change-detection.md's "OCR 폴백" section for the measured
memory/latency cost of that first call.
"""
from __future__ import annotations

import asyncio
import io
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from PIL import Image

_MAX_LENGTH = 60  # a one-line location hint, not a transcript -- same idea as selection_context._LABEL_MAX_LENGTH
_UNSET = object()
_engine = _UNSET  # OcrEngine | None, resolved once on first use (see _get_engine)


def text_label_at(rect: tuple[int, int, int, int]) -> str | None:
    """rect is a SCREEN-pixel (left, top, right, bottom) box, e.g. from
    screen_buffer._frame_to_screen_rect. Returns None on any failure (no
    language pack, winsdk unavailable, an empty/whitespace-only result, a
    screen region that no longer has anything legible by the time this
    runs) rather than raising."""
    try:
        text = asyncio.run(_recognize(rect))
    except Exception:
        return None
    text = " ".join(text.split())  # collapse newlines/runs of whitespace OCR can return
    if not text:
        return None
    return text if len(text) <= _MAX_LENGTH else text[:_MAX_LENGTH].rstrip() + "…"


def recognize_frame_text(image: "Image.Image") -> str:
    """Same best-effort, never-raises contract as text_label_at, but takes an
    already-captured image (e.g. ScreenReplayBuffer's own per-frame grab, via
    memory_ingest.py) instead of grabbing the screen itself, and returns the
    full recognized text (no _MAX_LENGTH one-line-hint truncation) for
    full-frame Screen Memory indexing rather than a location label."""
    try:
        text = asyncio.run(_recognize_image(image))
    except Exception:
        return ""
    return " ".join(text.split())


async def _recognize(rect: tuple[int, int, int, int]) -> str:
    if _get_engine() is None:
        return ""
    from PIL import ImageGrab

    image = ImageGrab.grab(bbox=rect, all_screens=True)
    return await _recognize_image(image)


async def _recognize_image(image: "Image.Image") -> str:
    engine = _get_engine()
    if engine is None:
        return ""
    from winsdk.windows.graphics.imaging import BitmapDecoder
    from winsdk.windows.storage.streams import DataWriter, InMemoryRandomAccessStream

    buf = io.BytesIO()
    image.convert("RGB").save(buf, format="PNG")

    stream = InMemoryRandomAccessStream()
    writer = DataWriter(stream.get_output_stream_at(0))
    writer.write_bytes(buf.getvalue())
    await writer.store_async()
    await writer.flush_async()
    stream.seek(0)

    decoder = await BitmapDecoder.create_async(stream)
    bitmap = await decoder.get_software_bitmap_async()
    result = await engine.recognize_async(bitmap)
    return result.text or ""


def _get_engine():
    """Cached after the first attempt (success OR failure) so a missing
    language pack doesn't retry the (cheap but pointless) creation call on
    every single capture -- see module docstring."""
    global _engine
    if _engine is _UNSET:
        try:
            from winsdk.windows.media.ocr import OcrEngine
            _engine = OcrEngine.try_create_from_user_profile_languages()
        except Exception:
            _engine = None
    return _engine
