"""Bridges the native screen-capture loop (ScreenReplayBuffer) into the
Screen Memory SQLite index (MemoryStore) -- mirrors the browser's own
"화면이 의미 있게 바뀌거나 15초가 지나면" auto-save cadence (see
docs/screen-memory.md) so native captures become searchable through the
same MCP tools/local HTTP API the browser's screen-share captures already
are (previously a documented gap: "네이티브 AirPointer 자체의 화면 버퍼는
아직 Screen Memory SQLite에 자동 적재되지 않습니다").
"""
from __future__ import annotations

import threading
import uuid
from typing import TYPE_CHECKING

import cv2
import numpy as np
from PIL import Image

from . import ocr_fallback
from .memory_store import MemoryStore

if TYPE_CHECKING:
    from .screen_buffer import ChangeEvent

# Same interval the browser uses for its own periodic (no-change) auto-save
# -- see docs/screen-memory.md's "화면이 의미 있게 바뀌거나 15초가 지나면".
_MIN_INTERVAL_SECONDS = 15.0
_JPEG_QUALITY = 70  # matches the ~0.62 quality/size tradeoff screen-memory.ts's toDataURL uses


class ScreenMemoryIngestor:
    """Consumes ScreenReplayBuffer's per-frame callback and decides whether
    the frame is "due" for Screen Memory (a change event just closed, or
    _MIN_INTERVAL_SECONDS elapsed since the last ingest) -- same trigger
    semantics as the browser side, so native and browser captures behave
    the same way for a user switching between them.

    Best-effort, never raises into the capture loop it's driven from (same
    contract as ocr_fallback.text_label_at) -- a missing OCR language pack,
    a full disk, or a locked SQLite file must never interrupt recording.

    One ingest runs at a time (a busy flag, not a queue): if OCR+SQLite
    ever falls behind the 15s/change-event cadence, the next few triggers
    are simply skipped rather than piling up work on a background thread.
    """

    def __init__(self, store: MemoryStore | None = None) -> None:
        self.store = store or MemoryStore()
        self._last_ingested = 0.0
        self._busy = threading.Lock()

    def consider(self, frame: np.ndarray, captured_at: float, event: "ChangeEvent | None") -> None:
        due = event is not None or (captured_at - self._last_ingested) >= _MIN_INTERVAL_SECONDS
        if not due or not self._busy.acquire(blocking=False):
            return
        self._last_ingested = captured_at
        # Copied before handing off -- ScreenReplayBuffer reuses/overwrites
        # its own frame buffer on the next capture, and this dict-in-place
        # would otherwise race the background thread reading it below.
        snapshot = frame.copy()
        threading.Thread(target=self._ingest, args=(snapshot, captured_at),
                          name="airpointer-memory-ingest", daemon=True).start()

    def _ingest(self, frame: np.ndarray, captured_at: float) -> None:
        try:
            height, width = frame.shape[:2]
            # frame is BGR (mss/cv2 convention throughout screen_buffer.py);
            # PIL/winsdk want RGB.
            image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            text = ocr_fallback.recognize_frame_text(image)
            ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, _JPEG_QUALITY])
            if not ok:
                return
            frame_id = uuid.uuid4().hex
            image_path = self.store.frames_dir / f"{frame_id}.jpg"
            image_path.write_bytes(encoded.tobytes())
            self.store.add_frame({
                "id": frame_id,
                "capturedAt": captured_at * 1000,
                "source": "native",
                "surface": "monitor",
                "width": int(width),
                "height": int(height),
                "text": text,
                "imagePath": str(image_path),
            })
        except Exception:
            pass
        finally:
            self._busy.release()
