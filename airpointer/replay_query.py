"""Standalone CLI: given a manifest.json written by screen_buffer.write_manifest()
and one or more relative-second offsets, extracts a still frame for each and
prints their paths as JSON. Invoked by Codex itself (see the `frameQuery`
block in the manifest, and airpointer_launcher.py's --replay-frame branch)
when a sent replay's 6 picked frames missed a moment it now wants to see --
see docs/replay-change-detection.md for the full design writeup.

Deliberately does NOT import anything Tk-related (main.py, capture_controller.py,
...) -- this has to run standalone, fast, without ever constructing the GUI app,
since airpointer_launcher.py dispatches here before touching any of that.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

from .screen_buffer import _imwrite


def query_frame(manifest_path: Path, offset_seconds: float) -> dict[str, object]:
    """Seeks into whichever of the manifest's copied segments covers
    `triggeredAt + offset_seconds` and saves one frame as a PNG next to the
    manifest (in a queries/ subfolder). Returns a JSON-able dict describing
    what was actually extracted -- actualOffsetSeconds can differ from what
    was asked for when the target falls outside every segment (clamped to
    the nearest one's own start/end, same spirit as _frame_index_for's
    None-target fallback in screen_buffer.py, just time- instead of
    index-based since there's no frame_count on hand here)."""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    segments = manifest.get("segments") or []
    if not segments:
        raise ValueError("Manifest has no segments -- nothing to query.")
    target_at = manifest["triggeredAt"] + offset_seconds
    segment = _find_segment(segments, target_at)
    seek_ms = max(0.0, min(segment["endedAt"] - segment["startedAt"],
                           target_at - segment["startedAt"])) * 1000
    capture = cv2.VideoCapture(segment["path"])
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, seek_ms)
        ok, frame = capture.read()
    finally:
        capture.release()
    if not ok:
        raise RuntimeError(f"Could not read a frame from {segment['path']!r} at {seek_ms:.0f}ms.")
    query_dir = manifest_path.parent / "queries"
    query_dir.mkdir(parents=True, exist_ok=True)
    safe_offset = f"{'plus' if offset_seconds >= 0 else 'minus'}{abs(offset_seconds):.3f}".replace(".", "_")
    frame_path = query_dir / f"{safe_offset}-{Path(segment['path']).stem}.png"
    if not _imwrite(frame_path, frame):
        raise RuntimeError(f"Could not save extracted frame to {frame_path}.")
    actual_offset = (segment["startedAt"] + seek_ms / 1000) - manifest["triggeredAt"]
    return {"requestedOffsetSeconds": offset_seconds, "actualOffsetSeconds": actual_offset,
            "framePath": str(frame_path)}


def _find_segment(segments: list[dict[str, object]], target_at: float) -> dict[str, object]:
    for segment in segments:
        if segment["startedAt"] <= target_at <= segment["endedAt"]:
            return segment
    return min(segments, key=lambda segment: _distance_to_segment(segment, target_at))


def _distance_to_segment(segment: dict[str, object], target_at: float) -> float:
    if target_at < segment["startedAt"]:
        return segment["startedAt"] - target_at
    if target_at > segment["endedAt"]:
        return target_at - segment["endedAt"]
    return 0.0


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Usage: --replay-frame <manifest.json> <-0.5> [<-1.2> ...]", file=sys.stderr)
        return 2
    manifest_path = Path(argv[0])
    try:
        offsets = [float(value) for value in argv[1:]]
    except ValueError:
        print(f"Invalid offset(s): {argv[1:]!r}", file=sys.stderr)
        return 2
    try:
        results = [query_frame(manifest_path, offset) for offset in offsets]
    except (OSError, ValueError, RuntimeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0
