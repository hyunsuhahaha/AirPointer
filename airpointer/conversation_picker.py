"""A search-as-you-type picker for choosing a Codex conversation. Renders
as just a compact search box -- the match list only appears once you've
typed something, so it doesn't take up space when idle. Leaving it empty
is a legitimate choice, not "nothing picked yet": get() returns "" for
"no explicit target" (e.g. DesktopPasteDelivery treats that as "whichever
conversation is already open")."""
from __future__ import annotations

import tkinter as tk
from collections.abc import Callable


class ConversationPicker(tk.Frame):
    def __init__(self, parent, on_select: Callable[[str], None], *,
                 bg: str = "#090908", fg: str = "#f5f1e8", accent: str = "#44e5ff",
                 muted: str = "#527f91", placeholder: str = "검색...",
                 max_visible: int = 5, **kwargs) -> None:
        super().__init__(parent, bg=bg, **kwargs)
        self.on_select = on_select
        self.fg, self.muted = fg, muted
        self.placeholder = placeholder
        self._labels: list[str] = []
        self._value = ""
        self._showing_placeholder = False

        self._query = tk.StringVar()
        self.entry = tk.Entry(self, textvariable=self._query, bg=bg, fg=fg,
                              insertbackground=accent, relief="flat",
                              highlightthickness=1, highlightbackground=muted,
                              highlightcolor=accent, font=("Segoe UI", 10))
        self.entry.pack(fill="x", ipady=5)
        self._query.trace_add("write", lambda *_args: self._on_type())
        self.entry.bind("<FocusIn>", self._clear_placeholder)
        self.entry.bind("<FocusOut>", lambda _e: self._apply_placeholder())

        self._list_frame = tk.Frame(self, bg=bg)  # packed on demand, see _refresh
        scrollbar = tk.Scrollbar(self._list_frame, orient="vertical")
        self.listbox = tk.Listbox(self._list_frame, height=max_visible, bg=bg, fg=fg,
                                  selectbackground=accent, selectforeground="#07131c",
                                  relief="flat", highlightthickness=0, activestyle="none",
                                  font=("Segoe UI", 10), yscrollcommand=scrollbar.set)
        scrollbar.config(command=self.listbox.yview)
        self.listbox.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        self.listbox.bind("<<ListboxSelect>>", self._on_pick)

        self._apply_placeholder()

    def set_options(self, labels: list[str]) -> None:
        self._labels = labels
        self._refresh()

    def set_value(self, label: str) -> None:
        self._value = label
        self._showing_placeholder = False
        self.entry.config(fg=self.fg)
        self._query.set(label)  # fires _on_type -> _refresh synchronously
        self._list_frame.pack_forget()  # ... which would show matches; a programmatic set isn't "actively searching"

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
        query = self._query.get().strip().lower()
        if not query:
            self._list_frame.pack_forget()
            return
        matches = [label for label in self._labels if query in label.lower()]
        self.listbox.delete(0, "end")
        for label in matches:
            self.listbox.insert("end", label)
        if matches:
            self._list_frame.pack(fill="both", expand=False, pady=(4, 0))
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
