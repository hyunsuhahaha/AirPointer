"""A search-as-you-type picker for choosing a Codex conversation. Renders
as just a compact search box -- the match list only appears once you've
typed something, so it doesn't take up space when idle. Leaving it empty
is a legitimate choice, not "nothing picked yet": get() returns "" for
"no explicit target" (e.g. DesktopPasteDelivery treats that as "whichever
conversation is already open")."""
from __future__ import annotations

import tkinter as tk
from collections.abc import Callable

# Explicit rather than "Segoe UI" (which has no Hangul glyphs of its own --
# Windows silently substitutes something for Korean text anyway, so naming
# it directly is the only way to be sure which font that actually is, and
# to get its metrics/weights consistently rather than whatever the fallback
# picks). Ships with every Windows 10/11 install, no font install needed.
# This still won't fully match the browser picker's look (Noto Sans KR,
# rendered by Chromium's antialiasing, which Tk/GDI text drawing doesn't
# reproduce) -- this closes the gap as far as font choice, size, and
# spacing can, not the rendering engine itself.
_FONT = "맑은 고딕"


class ConversationPicker(tk.Frame):
    def __init__(self, parent, on_select: Callable[[str], None], *,
                 bg: str = "#090908", fg: str = "#f5f1e8", accent: str = "#44e5ff",
                 muted: str = "#527f91", placeholder: str = "검색...",
                 max_visible: int = 5, idle_height: int = 220,
                 default_visible: int = 2, more_step: int = 3, **kwargs) -> None:
        super().__init__(parent, bg=bg, **kwargs)
        self.on_select = on_select
        self.bg, self.fg, self.accent, self.muted = bg, fg, accent, muted
        self.placeholder = placeholder
        self._default_visible = default_visible
        self._more_step = more_step
        self._labels: list[str] = []
        self._groups: list[tuple[str, list[str]]] = []
        self._expanded: dict[int, int] = {}
        self._value = ""
        self._showing_placeholder = False

        self._query = tk.StringVar()
        self.entry = tk.Entry(self, textvariable=self._query, bg=bg, fg=fg,
                              insertbackground=accent, relief="flat",
                              highlightthickness=1, highlightbackground=muted,
                              highlightcolor=accent, font=(_FONT, 11))
        self.entry.pack(fill="x", ipady=5)
        self._query.trace_add("write", lambda *_args: self._on_type())
        self.entry.bind("<FocusIn>", self._clear_placeholder)
        self.entry.bind("<FocusOut>", lambda _e: self._apply_placeholder())

        self._list_frame = tk.Frame(self, bg=bg)  # packed on demand, see _refresh
        # width=14 (Scrollbar's default is themeless and, packed alongside a
        # side="left" expand=True sibling, was measured collapsing to a 1px
        # sliver -- effectively invisible -- until the picker was widened
        # enough for pack's layout pass to give it any room at all).
        # Pinning a real width sidesteps that pack-timing quirk outright.
        scrollbar = tk.Scrollbar(self._list_frame, orient="vertical", width=14)
        self.listbox = tk.Listbox(self._list_frame, height=max_visible, bg=bg, fg=fg,
                                  selectbackground=accent, selectforeground="#07131c",
                                  relief="flat", highlightthickness=0, activestyle="none",
                                  font=(_FONT, 11), yscrollcommand=scrollbar.set)
        scrollbar.config(command=self.listbox.yview)
        # Packed scrollbar-first: Tk's pack carves out each slave's parcel
        # from the cavity in packing order, so an expand=True slave packed
        # before a fixed-size one can claim the entire cavity and leave the
        # latter a sliver (measured: the scrollbar collapsing to 1x1px).
        # Packing the fixed-size scrollbar first reserves its real width
        # before the listbox's expand=True has a chance to consume it.
        scrollbar.pack(side="right", fill="y")
        self.listbox.pack(side="left", fill="both", expand=True)
        self.listbox.bind("<<ListboxSelect>>", self._on_pick)

        # Idle grouped view -- shown instead of the plain search box being
        # empty, mirroring Codex Desktop's own sidebar: each project capped
        # to `default_visible` conversations with a "더 보기" row to reveal
        # `more_step` more at a time. Only used once set_grouped() is called;
        # a plain set_options() list keeps the old "empty box, nothing shown
        # until you type" behavior.
        self._idle_frame = tk.Frame(self, bg=bg)  # packed on demand, see _refresh
        self._idle_canvas = tk.Canvas(self._idle_frame, bg=bg, highlightthickness=0, height=idle_height)
        idle_scrollbar = tk.Scrollbar(self._idle_frame, orient="vertical", width=14, command=self._idle_canvas.yview)
        self._idle_canvas.configure(yscrollcommand=idle_scrollbar.set)
        # Same scrollbar-before-expand-sibling packing order as above, same
        # reason.
        idle_scrollbar.pack(side="right", fill="y")
        self._idle_canvas.pack(side="left", fill="both", expand=True)
        self._idle_inner = tk.Frame(self._idle_canvas, bg=bg)
        self._idle_window = self._idle_canvas.create_window((0, 0), window=self._idle_inner, anchor="nw")
        self._idle_inner.bind("<Configure>", lambda _e: self._idle_canvas.configure(
            scrollregion=self._idle_canvas.bbox("all")))
        self._idle_canvas.bind("<Configure>", lambda e: self._idle_canvas.itemconfig(
            self._idle_window, width=e.width))
        self._bind_wheel(self._idle_canvas)

        self._apply_placeholder()

    def set_options(self, labels: list[str]) -> None:
        self._labels = labels
        self._groups = []
        self._expanded = {}
        self._refresh()

    def set_grouped(self, groups: list[tuple[str, list[str]]]) -> None:
        """groups: ordered (project_name, conversation_titles); project_name
        == "" renders without a header (pinned/recent items with no project).
        Shown, collapsed per project, whenever the search box is idle."""
        self._groups = groups
        self._labels = [title for _, titles in groups for title in titles]
        self._expanded = {}
        self._refresh()

    def set_value(self, label: str) -> None:
        self._value = label
        self._showing_placeholder = False
        self.entry.config(fg=self.fg)
        self._query.set(label)  # fires _on_type -> _refresh synchronously
        self._list_frame.pack_forget()  # ... which would show matches; a programmatic set isn't "actively searching"
        self._idle_frame.pack_forget()

    def get(self) -> str:
        """"" means no explicit target -- the caller's own default applies."""
        return self._value

    def _on_type(self) -> None:
        if self._showing_placeholder:
            return
        if self._query.get() != self._value:
            self._value = ""
        self._refresh()

    def _refresh(self) -> None:
        query = "" if self._showing_placeholder else self._query.get().strip().lower()
        if not query:
            self._list_frame.pack_forget()
            if self._groups:
                self._render_idle()
                # expand=True (not False): lets this grow into whatever
                # extra vertical space the caller's own layout hands the
                # picker as a whole -- see main.py's _show_capture_prompt,
                # which packs the picker (not the question text box) as the
                # one expanding widget so resizing that window taller grows
                # the conversation list, not the question box.
                self._idle_frame.pack(fill="both", expand=True, pady=(4, 0))
            else:
                self._idle_frame.pack_forget()
            return
        self._idle_frame.pack_forget()
        matches = [label for label in self._labels if query in label.lower()]
        self.listbox.delete(0, "end")
        for label in matches:
            self.listbox.insert("end", label)
        if matches:
            self._list_frame.pack(fill="both", expand=True, pady=(4, 0))
        else:
            self._list_frame.pack_forget()

    def _on_pick(self, _event=None) -> None:
        selection = self.listbox.curselection()
        if not selection:
            return
        label = self.listbox.get(selection[0])
        self._value = label
        self._query.set(label)
        self._list_frame.pack_forget()
        self.on_select(label)

    def _render_idle(self) -> None:
        for child in self._idle_inner.winfo_children():
            child.destroy()
        for group_index, (project, titles) in enumerate(self._groups):
            if project:
                header = tk.Label(self._idle_inner, text=project, bg=self.bg, fg=self.accent, anchor="w",
                                  font=(_FONT, 10, "bold"))
                header.pack(fill="x", pady=(10 if group_index else 0, 4))
                self._bind_wheel(header)
            visible = self._expanded.get(group_index, self._default_visible)
            for title in titles[:visible]:
                self._make_idle_row(title)
            remaining = len(titles) - visible
            if remaining > 0:
                more = tk.Label(self._idle_inner, text=f"더 보기 ({remaining})", bg=self.bg, fg=self.muted,
                                anchor="w", font=(_FONT, 9), cursor="hand2")
                more.pack(fill="x", pady=(4, 0))
                more.bind("<Button-1>", lambda _e, group_index=group_index: self._expand(group_index))
                self._bind_wheel(more)

    def _expand(self, group_index: int) -> None:
        self._expanded[group_index] = self._expanded.get(group_index, self._default_visible) + self._more_step
        self._render_idle()

    def _make_idle_row(self, title: str) -> None:
        row = tk.Label(self._idle_inner, text=title, bg=self.bg, fg=self.fg, anchor="w",
                       font=(_FONT, 11), cursor="hand2", wraplength=280, justify="left")
        row.pack(fill="x", ipady=4)
        row.bind("<Button-1>", lambda _e, title=title: self._pick_idle(title))
        self._bind_wheel(row)

    def _bind_wheel(self, widget) -> None:
        # A canvas's own <MouseWheel> binding only fires when the cursor is
        # over canvas area not covered by a child widget -- every row here
        # is a Label drawn on top of the canvas via create_window, so without
        # this, scrolling only worked in the thin gaps between rows (which
        # is most of what "그려져서 안 보이는" scrolling looked like: wheel
        # events over the actual project/title text -- most of the visible
        # area -- went nowhere). Forwarding the same handler to every row
        # makes wheel scrolling work regardless of exactly what's under the
        # cursor, matching an ordinary scrollable list.
        widget.bind("<MouseWheel>", lambda e: self._idle_canvas.yview_scroll(
            -1 if e.delta > 0 else 1, "units"))

    def _pick_idle(self, title: str) -> None:
        self._value = title
        self._showing_placeholder = False
        self.entry.config(fg=self.fg)
        self._query.set(title)  # fires _on_type -> _refresh, which hides the idle view (non-empty query)
        self.on_select(title)

    def _clear_placeholder(self, _event=None) -> None:
        if self._showing_placeholder:
            self._showing_placeholder = False
            self.entry.config(fg=self.fg)
            self._query.set("")

    def _apply_placeholder(self) -> None:
        if not self._query.get():
            self._showing_placeholder = True
            self.entry.config(fg=self.muted)
            self._query.set(self.placeholder)
