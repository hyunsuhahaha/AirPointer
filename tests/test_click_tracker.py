import contextlib

import airpointer.click_tracker as click_tracker
from airpointer.click_tracker import _element_name_at


class _FakeElement:
    def __init__(self, handle, process_id, name, parent=None):
        self.handle = handle
        self.process_id = process_id
        self.name = name
        self.parent = parent


def test_element_name_at_returns_the_names_of_the_resolved_element(monkeypatch) -> None:
    element = _FakeElement(handle=999, process_id=4242, name="저장")
    monkeypatch.setattr(click_tracker.UIAElementInfo, "from_point", classmethod(lambda cls, x, y: element))

    assert _element_name_at(10, 20, window_hwnd=1) == "저장"


def test_element_name_at_climbs_unnamed_parents_to_find_a_name(monkeypatch) -> None:
    named_parent = _FakeElement(handle=998, process_id=4242, name="도구모음")
    leaf = _FakeElement(handle=999, process_id=4242, name="", parent=named_parent)
    monkeypatch.setattr(click_tracker.UIAElementInfo, "from_point", classmethod(lambda cls, x, y: leaf))

    assert _element_name_at(10, 20, window_hwnd=1) == "도구모음"


def test_element_name_at_stops_at_the_top_level_window_handle(monkeypatch) -> None:
    element = _FakeElement(handle=1, process_id=4242, name="창 제목")  # handle matches window_hwnd
    monkeypatch.setattr(click_tracker.UIAElementInfo, "from_point", classmethod(lambda cls, x, y: element))

    assert _element_name_at(10, 20, window_hwnd=1) == ""


def test_element_name_at_rejects_an_element_belonging_to_airpointer_itself(monkeypatch) -> None:
    # Defense in depth for when own_overlay_hidden() didn't actually manage
    # to uncover the real app underneath (e.g. hide silently failed) --
    # must never report AirPointer's own overlay as "what was clicked".
    monkeypatch.setattr(click_tracker, "_own_pid", 111)
    own_element = _FakeElement(handle=555, process_id=111, name="tk")
    monkeypatch.setattr(click_tracker.UIAElementInfo, "from_point", classmethod(lambda cls, x, y: own_element))

    assert _element_name_at(10, 20, window_hwnd=1) == ""


def test_element_name_at_climbing_also_rejects_an_own_process_ancestor(monkeypatch) -> None:
    monkeypatch.setattr(click_tracker, "_own_pid", 111)
    own_parent = _FakeElement(handle=556, process_id=111, name="tk")
    leaf = _FakeElement(handle=999, process_id=4242, name="", parent=own_parent)
    monkeypatch.setattr(click_tracker.UIAElementInfo, "from_point", classmethod(lambda cls, x, y: leaf))

    assert _element_name_at(10, 20, window_hwnd=1) == ""


def test_element_name_at_returns_empty_on_any_failure(monkeypatch) -> None:
    def _raise(cls, x, y):
        raise RuntimeError("UI Automation not ready")
    monkeypatch.setattr(click_tracker.UIAElementInfo, "from_point", classmethod(_raise))

    assert _element_name_at(10, 20, window_hwnd=1) == ""


def test_element_name_at_wraps_the_point_query_in_own_overlay_hidden(monkeypatch) -> None:
    order: list[str] = []

    @contextlib.contextmanager
    def fake_own_overlay_hidden():
        order.append("hide")
        yield
        order.append("show")

    def from_point(cls, x, y):
        order.append("query")
        return _FakeElement(handle=999, process_id=4242, name="저장")

    monkeypatch.setattr(click_tracker, "own_overlay_hidden", fake_own_overlay_hidden)
    monkeypatch.setattr(click_tracker.UIAElementInfo, "from_point", classmethod(from_point))

    assert _element_name_at(10, 20, window_hwnd=1) == "저장"
    assert order == ["hide", "query", "show"]
