"""Local debug viewer for the replay change-detection pipeline -- see
docs/replay-change-detection.md for the design this inspects.

Re-runs the exact same detection (_ChangeTracker) and selection
(_select_notable_moments, _frame_index_for) functions export_recent() uses
in production, over whatever .mp4 segments are sitting in a replay buffer
folder, and writes a single self-contained HTML report (images embedded as
base64 JPEG, no server or network needed) showing:

  - a timeline of every detected ChangeEvent (score, whether it was
    actually selected)
  - the exact frames export_recent() would send for the given
    --seconds/--frame-count, with the segment/timestamp/score that produced
    each one, and a red box drawn where the event's bbox says the change was

This never uploads anything anywhere -- it is a plain local HTML file,
opened straight from disk, because the captured frames are real screen
content that may be sensitive.

IMPORTANT: ScreenReplayBuffer.stop() deletes segments by default (clear=
True). Run this while AirPointer is still actively tracking (or against a
folder you copied aside beforehand), or there will be nothing to load.

Usage:
    python tools/debug_replay.py [--root PATH] [--seconds N] [--frame-count N] [--no-open]
"""
from __future__ import annotations

import argparse
import base64
import os
import re
import sys
import time
import webbrowser
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from airpointer.screen_buffer import (  # noqa: E402
    ChangeEvent, Segment, _ChangeTracker, _frame_index_for, _select_notable_moments,
)

_SEGMENT_NAME = re.compile(r"^(\d+\.\d+)\.mp4$")


def _default_root() -> Path:
    local = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    return local / "AirPointer" / "replay"


def _load_segments(root: Path) -> list[Segment]:
    segments = []
    for path in sorted(root.glob("*.mp4")):
        match = _SEGMENT_NAME.match(path.name)
        if not match:
            continue
        started = float(match.group(1))
        capture = cv2.VideoCapture(str(path))
        try:
            count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = capture.get(cv2.CAP_PROP_FPS) or 10.0
        finally:
            capture.release()
        if count <= 0:
            continue
        ended = started + count / fps
        segments.append(Segment(path, started, ended, path.stat().st_size))
    return segments


def _replay_events(segments: list[Segment]) -> list[ChangeEvent]:
    """Feeds every frame of every segment (in order) through a fresh
    _ChangeTracker to reconstruct the ChangeEvent list -- these are never
    persisted to disk by the live app (only kept in ScreenReplayBuffer's own
    process memory), so a standalone script has to regenerate them from the
    segments themselves. Detection is a pure function of the frame
    sequence, so this reproduces exactly what the live run would have seen."""
    tracker = _ChangeTracker()
    events: list[ChangeEvent] = []
    for segment in segments:
        capture = cv2.VideoCapture(str(segment.path))
        try:
            count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = capture.get(cv2.CAP_PROP_FPS) or 10.0
            for index in range(count):
                ok, frame = capture.read()
                if not ok:
                    break
                at = segment.started + index / fps
                event = tracker.observe(frame, at)
                if event is not None:
                    events.append(event)
        finally:
            capture.release()
    return events


def _read_frame(segment: Segment, target_at: float | None) -> np.ndarray | None:
    capture = cv2.VideoCapture(str(segment.path))
    try:
        count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        capture.set(cv2.CAP_PROP_POS_FRAMES, _frame_index_for(segment, target_at, count))
        ok, frame = capture.read()
    finally:
        capture.release()
    return frame if ok else None


def _draw_bbox(frame: np.ndarray, bbox: tuple[int, int, int, int]) -> np.ndarray:
    marked = frame.copy()
    left, top, right, bottom = bbox
    cv2.rectangle(marked, (left, top), (right, bottom), (0, 0, 255), 3)
    return marked


def _to_data_url(frame: np.ndarray, max_width: int = 480) -> str:
    height, width = frame.shape[:2]
    if width > max_width:
        scale = max_width / width
        frame = cv2.resize(frame, (max_width, round(height * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ok:
        return ""
    return "data:image/jpeg;base64," + base64.b64encode(buf).decode("ascii")


def _build_report(segments: list[Segment], events: list[ChangeEvent],
                   picks: list[tuple[Segment, float | None]], window_start: float) -> str:
    picked_keys = {(segment.path, round(at, 1)) for segment, at in picks if at is not None}
    picked_paths_no_target = {segment.path for segment, at in picks if at is None}

    timeline_dots = []
    for event in sorted(events, key=lambda e: e.peak_at):
        rel = event.peak_at - window_start
        selected = (next((s for s in segments if s.started <= event.peak_at <= s.ended), None),)
        seg = selected[0]
        is_picked = seg is not None and (seg.path, round(event.peak_at, 1)) in picked_keys
        timeline_dots.append(
            f'<div class="dot {"picked" if is_picked else ""}" '
            f'style="left:{rel:.2f}s" title="t={rel:.2f}s score={event.peak_score:.3f} '
            f'bbox={event.bbox}"></div>'
        )
    total_span = max((s.ended for s in segments), default=window_start) - window_start

    frame_cards = []
    for index, (segment, target_at) in enumerate(picks, 1):
        frame = _read_frame(segment, target_at)
        if frame is None:
            frame_cards.append(f'<div class="card"><p>frame {index}: 읽기 실패 ({segment.path.name})</p></div>')
            continue
        matching_event = next(
            (e for e in events if e.peak_at == target_at), None) if target_at is not None else None
        marked = _draw_bbox(frame, matching_event.bbox) if matching_event else frame
        label = (f"이벤트 · score={matching_event.peak_score:.3f}" if matching_event
                 else "중간 프레임 (이벤트 없음/균등분할)")
        rel = "" if target_at is None else f"t={target_at - window_start:.2f}s"
        frame_cards.append(f'''
        <div class="card">
          <img src="{_to_data_url(marked)}" />
          <div class="meta">
            <b>#{index}</b> {segment.path.name}<br/>
            {label}<br/>
            {rel}
          </div>
        </div>''')

    event_rows = []
    for event in sorted(events, key=lambda e: e.peak_score, reverse=True):
        seg = next((s for s in segments if s.started <= event.peak_at <= s.ended), None)
        thumb = _read_frame(seg, event.peak_at) if seg else None
        thumb_html = f'<img src="{_to_data_url(_draw_bbox(thumb, event.bbox), 160)}"/>' if thumb is not None else ""
        picked = seg is not None and (seg.path, round(event.peak_at, 1)) in picked_keys
        event_rows.append(f'''
        <tr class="{"picked-row" if picked else ""}">
          <td>{thumb_html}</td>
          <td>{event.peak_at - window_start:.2f}s</td>
          <td>{event.peak_score:.3f}</td>
          <td>{event.bbox}</td>
          <td>{event.ended_at - event.started_at:.2f}s</td>
          <td>{"O 선택됨" if picked else ""}</td>
        </tr>''')

    return f'''<!doctype html>
<html><head><meta charset="utf-8"><title>Replay Debug</title>
<style>
body {{ font-family: Consolas, monospace; background: #0b1216; color: #cdeaf5; padding: 20px; }}
h1, h2 {{ color: #44e5ff; }}
.timeline {{ position: relative; height: 40px; background: #111c22; border: 1px solid #234; margin: 20px 0; }}
.dot {{ position: absolute; top: 8px; width: 10px; height: 10px; border-radius: 50%; background: #527f91; }}
.dot.picked {{ background: #ff5c22; box-shadow: 0 0 6px #ff5c22; }}
.grid {{ display: flex; flex-wrap: wrap; gap: 14px; }}
.card {{ background: #111c22; border: 1px solid #234; padding: 8px; width: 260px; }}
.card img {{ width: 100%; display: block; }}
.meta {{ font-size: 12px; margin-top: 6px; color: #9bd; }}
table {{ border-collapse: collapse; width: 100%; margin-top: 10px; }}
td, th {{ border: 1px solid #234; padding: 6px; font-size: 12px; text-align: left; }}
.picked-row {{ background: #1a2a1a; }}
img {{ max-width: 160px; }}
</style></head>
<body>
<h1>Replay Change-Detection Debug</h1>
<p>세그먼트 {len(segments)}개, 감지된 이벤트 {len(events)}개, 선택된 프레임 {len(picks)}개 (생성: {time.strftime("%Y-%m-%d %H:%M:%S")})</p>

<h2>타임라인 (주황 점 = 실제 선택됨)</h2>
<div class="timeline">{"".join(timeline_dots)}</div>
<p style="font-size:11px;color:#789">0s ~ {total_span:.1f}s (마우스 오버로 시각/점수/bbox 확인)</p>

<h2>실제 전송될 프레임 ({len(picks)}장)</h2>
<div class="grid">{"".join(frame_cards)}</div>

<h2>감지된 전체 이벤트 (점수순)</h2>
<table>
<tr><th>썸네일</th><th>시각(창 기준)</th><th>점수</th><th>bbox</th><th>지속시간</th><th>선택여부</th></tr>
{"".join(event_rows)}
</table>
</body></html>'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=_default_root(),
                        help="replay segment folder (default: live AirPointer replay dir)")
    parser.add_argument("--seconds", type=int, default=0,
                        help="window size like export_recent's `seconds` (default: whole loaded buffer)")
    parser.add_argument("--frame-count", type=int, default=6)
    parser.add_argument("--out", type=Path, default=None,
                        help="output HTML path (default: <root>/../debug-replay-report.html)")
    parser.add_argument("--no-open", action="store_true", help="don't auto-open the report in a browser")
    args = parser.parse_args()

    segments = _load_segments(args.root)
    if not segments:
        print(f"세그먼트를 못 찾았어요: {args.root}")
        print("AirPointer가 트래킹 중일 때(stop 전에) 실행해야 합니다 -- stop()이 기본적으로 세그먼트를 지웁니다.")
        return

    window_start = segments[0].started
    cutoff = segments[-1].ended - args.seconds if args.seconds > 0 else window_start
    windowed = [s for s in segments if s.ended >= cutoff]

    print(f"세그먼트 {len(segments)}개 로드, 프레임 재생하며 변화 감지 중... (시간이 좀 걸릴 수 있어요)")
    events = _replay_events(segments)
    windowed_events = [e for e in events if e.peak_at >= cutoff]
    picks = _select_notable_moments(windowed, windowed_events, min(args.frame_count, len(windowed)))

    html = _build_report(windowed, windowed_events, picks, cutoff if args.seconds > 0 else window_start)
    out_path = args.out or (args.root.parent / "debug-replay-report.html")
    out_path.write_text(html, encoding="utf-8")
    print(f"리포트 생성: {out_path}")
    if not args.no_open:
        webbrowser.open(out_path.resolve().as_uri())


if __name__ == "__main__":
    main()
