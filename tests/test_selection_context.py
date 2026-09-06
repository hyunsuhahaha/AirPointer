import airpointer.selection_context as selection_context


class _FakeElementInfo:
    def __init__(self, process_id: int, name: str, control_type: str) -> None:
        self.process_id = process_id
        self.name = name
        self.control_type = control_type


def _stub_from_point(monkeypatch, info: _FakeElementInfo, own_pid: int = 111) -> None:
    monkeypatch.setattr(selection_context.UIAElementInfo, "from_point",
                         classmethod(lambda cls, x, y: info))
    monkeypatch.setattr(selection_context, "_own_pid", own_pid)


def test_element_label_at_joins_name_and_mapped_control_type(monkeypatch) -> None:
    _stub_from_point(monkeypatch, _FakeElementInfo(999, "저장", "Button"))
    assert selection_context.element_label_at(10, 20) == "저장 버튼"


def test_element_label_at_falls_back_to_bare_name_for_unmapped_control_type(monkeypatch) -> None:
    # Pane/Group/Custom/... aren't in _CONTROL_TYPE_LABELS -- guessing a
    # Korean noun for them would read worse than just the element's name.
    _stub_from_point(monkeypatch, _FakeElementInfo(999, "썸네일", "Custom"))
    assert selection_context.element_label_at(10, 20) == "썸네일"


def test_element_label_at_returns_none_for_an_unnamed_element(monkeypatch) -> None:
    _stub_from_point(monkeypatch, _FakeElementInfo(999, "", "Button"))
    assert selection_context.element_label_at(10, 20) is None


def test_element_label_at_returns_none_for_airpointers_own_window(monkeypatch) -> None:
    # The capture overlay can itself be on screen during a replay -- must
    # never report "our own button" as the notable-change element.
    _stub_from_point(monkeypatch, _FakeElementInfo(111, "Start", "Button"), own_pid=111)
    assert selection_context.element_label_at(10, 20) is None


def test_element_label_at_truncates_long_labels(monkeypatch) -> None:
    _stub_from_point(monkeypatch, _FakeElementInfo(999, "가" * 40, ""))
    label = selection_context.element_label_at(10, 20)
    assert label is not None
    assert label.endswith("…")
    assert len(label) == selection_context._LABEL_MAX_LENGTH + 1


def test_element_label_at_returns_none_on_any_failure(monkeypatch) -> None:
    def _raise(cls, x, y):
        raise RuntimeError("UI Automation not ready")
    monkeypatch.setattr(selection_context.UIAElementInfo, "from_point", classmethod(_raise))
    assert selection_context.element_label_at(10, 20) is None


def test_register_own_overlay_hwnd_resolves_the_real_top_level_ancestor(monkeypatch) -> None:
    # winfo_id() returns Tk's INNER content hwnd, not the actual top-level
    # window Windows Z-orders against the desktop -- confirmed by hand:
    # hiding winfo_id()'s own hwnd had zero effect on ElementFromPoint's
    # hit test (it kept resolving to a same-process window at the exact
    # full-desktop rect regardless), while hiding GetAncestor(hwnd,
    # GA_ROOT) was what actually let the query see through to the real
    # window underneath. See register_own_overlay_hwnd's docstring.
    monkeypatch.setattr(selection_context, "_own_overlay_hwnd", None)
    monkeypatch.setattr(selection_context.ctypes.windll.user32, "GetAncestor",
                         lambda hwnd, flag: hwnd + 1000)

    selection_context.register_own_overlay_hwnd(42)

    assert selection_context._own_overlay_hwnd == 1042


def test_register_own_overlay_hwnd_falls_back_to_the_given_hwnd_if_get_ancestor_fails(monkeypatch) -> None:
    monkeypatch.setattr(selection_context, "_own_overlay_hwnd", None)

    def _raise(hwnd, flag):
        raise OSError("no ancestor")
    monkeypatch.setattr(selection_context.ctypes.windll.user32, "GetAncestor", _raise)

    selection_context.register_own_overlay_hwnd(42)

    assert selection_context._own_overlay_hwnd == 42


def test_register_own_overlay_hwnd_falls_back_if_get_ancestor_returns_zero(monkeypatch) -> None:
    # GetAncestor legitimately returns 0 ("no such ancestor") in some cases
    # -- must not store that as if it were a real hwnd to hide.
    monkeypatch.setattr(selection_context, "_own_overlay_hwnd", None)
    monkeypatch.setattr(selection_context.ctypes.windll.user32, "GetAncestor", lambda hwnd, flag: 0)

    selection_context.register_own_overlay_hwnd(42)

    assert selection_context._own_overlay_hwnd == 42


def test_set_own_overlay_visible_is_a_noop_without_registration(monkeypatch) -> None:
    monkeypatch.setattr(selection_context, "_own_overlay_hwnd", None)

    def _fail(*args):
        raise AssertionError("SetWindowPos must not be called without a registered hwnd")
    monkeypatch.setattr(selection_context.ctypes.windll.user32, "SetWindowPos", _fail)

    selection_context._set_own_overlay_visible(False)  # must not raise


def test_set_own_overlay_visible_toggles_via_set_window_pos(monkeypatch) -> None:
    monkeypatch.setattr(selection_context, "_own_overlay_hwnd", 4242)
    calls = []
    monkeypatch.setattr(selection_context.ctypes.windll.user32, "SetWindowPos",
                         lambda hwnd, after, x, y, cx, cy, flags: calls.append((hwnd, flags)))

    selection_context._set_own_overlay_visible(False)
    selection_context._set_own_overlay_visible(True)

    (hwnd_hide, flags_hide), (hwnd_show, flags_show) = calls
    assert hwnd_hide == hwnd_show == 4242
    assert flags_hide & selection_context._SWP_HIDEWINDOW
    assert flags_show & selection_context._SWP_SHOWWINDOW
    # Both calls must be visibility-only -- no move/resize/z-order/activation
    # side effects on whatever window is really at that point.
    for flags in (flags_hide, flags_show):
        assert flags & selection_context._SWP_NOACTIVATE
        assert flags & selection_context._SWP_NOMOVE
        assert flags & selection_context._SWP_NOSIZE
        assert flags & selection_context._SWP_NOZORDER


def test_set_own_overlay_visible_swallows_set_window_pos_failures(monkeypatch) -> None:
    monkeypatch.setattr(selection_context, "_own_overlay_hwnd", 4242)

    def _raise(*args):
        raise OSError("window gone")
    monkeypatch.setattr(selection_context.ctypes.windll.user32, "SetWindowPos", _raise)

    selection_context._set_own_overlay_visible(False)  # must not raise


def test_element_label_at_hides_overlay_before_the_query_and_shows_it_after(monkeypatch) -> None:
    monkeypatch.setattr(selection_context, "_own_overlay_hwnd", 4242)
    order = []
    monkeypatch.setattr(selection_context, "_set_own_overlay_visible",
                         lambda visible: order.append(("show" if visible else "hide")))

    def _from_point(cls, x, y):
        order.append("query")
        return _FakeElementInfo(999, "저장", "Button")
    monkeypatch.setattr(selection_context.UIAElementInfo, "from_point", classmethod(_from_point))
    monkeypatch.setattr(selection_context, "_own_pid", 111)

    assert selection_context.element_label_at(10, 20) == "저장 버튼"
    assert order == ["hide", "query", "show"]


def test_element_label_at_still_shows_overlay_again_if_the_query_raises(monkeypatch) -> None:
    monkeypatch.setattr(selection_context, "_own_overlay_hwnd", 4242)
    order = []
    monkeypatch.setattr(selection_context, "_set_own_overlay_visible",
                         lambda visible: order.append("show" if visible else "hide"))

    def _raise(cls, x, y):
        order.append("query")
        raise RuntimeError("boom")
    monkeypatch.setattr(selection_context.UIAElementInfo, "from_point", classmethod(_raise))

    assert selection_context.element_label_at(10, 20) is None
    assert order == ["hide", "query", "show"]
