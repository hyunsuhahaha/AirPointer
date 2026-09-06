"""Tests for _select_events_diverse() and _bbox_iou() -- the MMR-style
diversity re-ranking plus localized-event floor guarantee described in
docs/replay-change-detection.md's "다양성 있는 프레임 선택" section. These
replace plain top-K-by-peak_score in _select_notable_moments(), which let
several near-duplicate large events (three segments of one long scroll, say)
crowd out a single, differently-located small event every time."""
from pathlib import Path

from airpointer.screen_buffer import (
    ChangeEvent,
    Segment,
    _bbox_iou,
    _select_events_diverse,
    _select_notable_moments,
)


def test_bbox_iou_identical_boxes_is_one() -> None:
    box = (0, 0, 100, 100)
    assert _bbox_iou(box, box) == 1.0


def test_bbox_iou_disjoint_boxes_is_zero() -> None:
    assert _bbox_iou((0, 0, 100, 100), (200, 200, 300, 300)) == 0.0


def test_bbox_iou_partial_overlap() -> None:
    # Two 100x100 boxes overlapping in a 50x100 strip -> intersection 5000,
    # union 100*100 + 100*100 - 5000 = 15000.
    assert _bbox_iou((0, 0, 100, 100), (50, 0, 150, 100)) == 5000 / 15000


def _scroll_event(peak_at: float, peak_score: float, bbox: tuple[int, int, int, int]) -> ChangeEvent:
    # extent=0.4: most of the screen changed, well above _LOCALIZED_EXTENT_MAX --
    # a scroll/window-switch, not a toast.
    return ChangeEvent(started_at=peak_at - 0.1, peak_at=peak_at, ended_at=peak_at + 0.2,
                        peak_score=peak_score, bbox=bbox, extent=0.4)


def _toast_event(peak_at: float, peak_score: float, bbox: tuple[int, int, int, int]) -> ChangeEvent:
    # extent=0.01: a small corner of the screen, below _LOCALIZED_EXTENT_MAX.
    return ChangeEvent(started_at=peak_at - 0.1, peak_at=peak_at, ended_at=peak_at + 0.2,
                        peak_score=peak_score, bbox=bbox, extent=0.01)


def test_select_events_diverse_prefers_a_distinct_event_over_a_near_duplicate() -> None:
    # Three near-identical, overlapping "scroll" events (as if the same long
    # scroll got split into consecutive ChangeEvents) all outscore one
    # differently-located toast. Plain top-K-by-score would fill both slots
    # with scrolls; MMR's overlap penalty should let the toast win the
    # second slot once the first scroll is already picked.
    scroll_a = _scroll_event(1.0, 0.50, (0, 0, 1000, 800))
    scroll_b = _scroll_event(1.5, 0.45, (0, 0, 1000, 800))
    scroll_c = _scroll_event(2.0, 0.42, (10, 10, 990, 790))
    toast = _toast_event(3.0, 0.16, (900, 700, 980, 780))

    picked = _select_events_diverse([scroll_a, scroll_b, scroll_c, toast], budget=2)

    assert scroll_a in picked
    assert toast in picked
    assert scroll_b not in picked
    assert scroll_c not in picked


def test_select_events_diverse_guarantees_a_localized_slot_the_floor_needs() -> None:
    # Two BROAD but non-overlapping events (different screen halves) don't
    # penalize each other under MMR at all, so pure MMR still fills both
    # slots with them and never gives the low-score toast a look-in on
    # score alone. The floor guarantee is what has to rescue this case.
    scroll_left = _scroll_event(1.0, 0.50, (0, 0, 500, 800))
    scroll_right = _scroll_event(2.0, 0.45, (500, 0, 1000, 800))
    toast = _toast_event(3.0, 0.16, (700, 700, 750, 750))

    picked = _select_events_diverse([scroll_left, scroll_right, toast], budget=2)

    assert scroll_left in picked
    assert toast in picked
    assert scroll_right not in picked  # evicted as the weakest pick to make room


def test_select_events_diverse_appends_the_localized_floor_when_budget_has_room() -> None:
    # Budget bigger than the number of broad events picked so far -- the
    # floor should just append the localized event, not evict anything.
    scroll = _scroll_event(1.0, 0.50, (0, 0, 500, 800))
    toast = _toast_event(2.0, 0.16, (700, 700, 750, 750))

    picked = _select_events_diverse([scroll, toast], budget=3)

    assert scroll in picked and toast in picked
    assert len(picked) == 2


def test_select_events_diverse_is_a_noop_with_no_redundancy_or_localized_gap() -> None:
    # All distinct, none localized -- behaves like plain top-K.
    a = _scroll_event(1.0, 0.50, (0, 0, 300, 300))
    b = _scroll_event(2.0, 0.45, (600, 0, 900, 300))
    c = _scroll_event(3.0, 0.40, (0, 600, 300, 900))

    picked = _select_events_diverse([a, b, c], budget=2)

    assert picked == [a, b]


def test_select_notable_moments_end_to_end_keeps_the_toast_over_a_redundant_scroll() -> None:
    # Same "two broad, non-overlapping events crowd out a toast" scenario as
    # above, but through the real entry point used by export_recent(),
    # with real Segments so peak_at actually maps to a frame.
    segments = [Segment(Path(f"seg{i}.mp4"), started=float(i), ended=float(i + 1), size=1)
                for i in range(5)]
    scroll_left = _scroll_event(1.5, 0.50, (0, 0, 500, 800))
    scroll_right = _scroll_event(2.5, 0.45, (500, 0, 1000, 800))
    toast = _toast_event(3.5, 0.16, (700, 700, 750, 750))

    # count=4 -> event budget is count-2=2, plus the window's first/last
    # segment boundary slots.
    picks = _select_notable_moments(segments, [scroll_left, scroll_right, toast], count=4)
    picked_times = {target_at for _, target_at, _, _ in picks if target_at is not None}

    assert 1.5 in picked_times   # scroll_left, the highest-scoring event
    assert 3.5 in picked_times   # toast, rescued by the localized floor
    assert 2.5 not in picked_times  # scroll_right, evicted as redundant/weaker
