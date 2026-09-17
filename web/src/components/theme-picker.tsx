"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Moon, Palette, Sun } from "@phosphor-icons/react";
import { ACCENTS, applyTheme, parseTheme, saveTheme, serverThemeSnapshot, subscribeTheme, themeSnapshot } from "@/lib/theme";
import type { Theme } from "@/lib/theme";
import styles from "./theme-picker.module.css";

export function ThemePicker() {
  // The server renders the default; the saved theme takes over right after hydration.
  const snapshot = useSyncExternalStore(subscribeTheme, themeSnapshot, serverThemeSnapshot);
  const theme = parseTheme(safeParse(snapshot));
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);

  const change = (patch: Partial<Theme>) => {
    const next = { ...theme, ...patch };
    saveTheme(next); applyTheme(next, document.documentElement);
  };

  return <div ref={root} className={styles.picker}>
    <button type="button" className={styles.trigger} aria-expanded={open} aria-label="테마 설정" title="테마 설정" onClick={() => setOpen((value) => !value)}>
      <i className={styles.dot} style={{ background: ACCENTS.find((accent) => accent.id === theme.accent)?.swatch }} />
      {theme.mode === "light" ? <Sun size={15} weight="bold" /> : <Moon size={15} weight="bold" />}
      <span>테마</span><Palette size={15} weight="bold" />
    </button>
    {open && <div className={styles.menu} role="dialog" aria-label="테마 설정">
      <p>화면</p>
      <div className={styles.modes} role="radiogroup" aria-label="화면 밝기">
        <button type="button" role="radio" aria-checked={theme.mode === "dark"} onClick={() => change({ mode: "dark" })}><Moon size={14} weight="bold" />어둡게</button>
        <button type="button" role="radio" aria-checked={theme.mode === "light"} onClick={() => change({ mode: "light" })}><Sun size={14} weight="bold" />밝게</button>
      </div>
      <p>포인트 색</p>
      <div className={styles.swatches} role="radiogroup" aria-label="포인트 색">
        {ACCENTS.map((accent) => <button key={accent.id} type="button" role="radio" aria-checked={theme.accent === accent.id} aria-label={accent.label} title={accent.label}
          style={{ background: accent.swatch }} onClick={() => change({ accent: accent.id })} />)}
      </div>
    </div>}
  </div>;
}

function safeParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return null; }
}
