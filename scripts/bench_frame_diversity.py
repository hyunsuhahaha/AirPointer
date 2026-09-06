"""Benchmarks _select_events_diverse()/_select_notable_moments() against the
old plain top-K-by-peak_score approach, at both a realistic event count (a
busy 30s window) and a deliberate stress count, to confirm the new MMR +
localized-floor selection doesn't introduce meaningful overhead relative to
what it replaced. Prints wall-clock timings; makes no assertions (this is a
report, not a pytest suite -- see tests/test_frame_diversity.py for
correctness tests)."""
from __future__ import annotations

import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # repo root, so `python scripts/bench_frame_diversity.py` works from anywhere

from airpointer.screen_buffer import (  # noqa: E402
    ChangeEvent,
    Segment,
    _select_events_diverse,
    _select_notable_moments,
)


def _old_select_notable_moments(segments: list[Segment], events: list[ChangeEvent], count: int):
    """The exact previous implementation (plain top-K by peak_score, no
    diversity/localized-floor), kept here only to benchmark against -- this
    is what production ran before this change."""
    by_time = sorted(segments, key=lambda item: item.started)

    def segment_for(at: float) -> Segment | None:
        return next((item for item in by_time if item.started <= at <= item.ended), None)

    picks = []
    seen = set()
    picked_paths = set()
    for event in sorted(events, key=lambda item: item.peak_score, reverse=True):
        segment = segment_for(event.peak_at)
        if segment is None:
            continue
        key = (segment.path, round(event.peak_at, 1))
        if key in seen:
            continue
        seen.add(key)
        picked_paths.add(segment.path)
        picks.append((segment, event.peak_at, event.bbox, event.element_label))
        if len(picks) >= max(0, count - 2):
            break

    result = list(picks)
    for boundary in (by_time[0], by_time[-1]):
        if boundary.path not in picked_paths:
            result.append((boundary, None, None, None))
            picked_paths.add(boundary.path)
    result.sort(key=lambda item: item[1] if item[1] is not None else item[0].started)
    return result[:count]


def _make_events(n: int, window_seconds: int, seed: int) -> tuple[list[Segment], list[ChangeEvent]]:
    rng = random.Random(seed)
    segments = [Segment(Path(f"seg{i}.mp4"), started=float(i), ended=float(i + 1), size=1)
                for i in range(window_seconds)]
    events = []
    for _ in range(n):
        peak_at = rng.uniform(0.05, window_seconds - 0.05)
        left = rng.uniform(0, 900)
        top = rng.uniform(0, 700)
        width = rng.uniform(20, 900)
        height = rng.uniform(20, 700)
        localized = rng.random() < 0.2
        events.append(ChangeEvent(
            started_at=peak_at - 0.1, peak_at=peak_at, ended_at=peak_at + 0.1,
            peak_score=rng.uniform(0.15, 0.6) if not localized else rng.uniform(0.15, 0.2),
            bbox=(int(left), int(top), int(left + width), int(top + height)),
            extent=rng.uniform(0.1, 0.6) if not localized else rng.uniform(0.0, 0.04),
        ))
    return segments, events


def _time_it(fn, repeats: int) -> float:
    start = time.perf_counter()
    for _ in range(repeats):
        fn()
    return (time.perf_counter() - start) / repeats


def main() -> None:
    scenarios = [
        ("realistic (15 events / 30s window)", 15, 30, 2000),
        ("busy (60 events / 30s window)", 60, 30, 500),
        ("stress (500 events / 30s window)", 500, 30, 50),
    ]
    print(f"{'scenario':38} {'old (top-K)':>14} {'new (MMR+floor)':>18} {'overhead':>10}")
    for label, n_events, window_seconds, repeats in scenarios:
        segments, events = _make_events(n_events, window_seconds, seed=42)
        old_time = _time_it(lambda: _old_select_notable_moments(segments, events, count=6), repeats)
        new_time = _time_it(lambda: _select_notable_moments(segments, events, count=6), repeats)
        overhead_us = (new_time - old_time) * 1e6
        print(f"{label:38} {old_time*1e6:11.1f}us {new_time*1e6:15.1f}us {overhead_us:8.1f}us")

    # _select_events_diverse alone, isolating the selection step from
    # segment-mapping/dedup overhead shared by both old and new paths above.
    print()
    print("_select_events_diverse alone (budget=4):")
    for n_events in (15, 60, 500, 2000):
        _, events = _make_events(n_events, window_seconds=30, seed=7)
        repeats = 2000 if n_events <= 60 else (200 if n_events <= 500 else 20)
        elapsed = _time_it(lambda: _select_events_diverse(events, budget=4), repeats)
        print(f"  {n_events:5d} candidate events: {elapsed*1e6:9.1f}us/call")


if __name__ == "__main__":
    main()
