// Page theme: light/dark and an accent color, applied as classes on <html>.
// globals.css maps those classes to the --t-* tokens the components use; the
// export PiP copies <html>'s classes, so it follows along.

export const MODES = ["dark", "light"] as const;
export type ThemeMode = (typeof MODES)[number];
export const ACCENTS = [
  { id: "orange", label: "주황", swatch: "#ff6b22" },
  { id: "blue", label: "파랑", swatch: "#4f8cff" },
  { id: "green", label: "초록", swatch: "#2fbf71" },
  { id: "violet", label: "보라", swatch: "#9b7bff" },
  { id: "pink", label: "분홍", swatch: "#ff5fa2" },
  { id: "mono", label: "무채색", swatch: "#9a988f" },
] as const;
export type Accent = (typeof ACCENTS)[number]["id"];
export type Theme = { mode: ThemeMode; accent: Accent };

export const DEFAULT_THEME: Theme = { mode: "dark", accent: "orange" };
export const THEME_STORAGE_KEY = "whatwas.theme";

export function parseTheme(value: unknown): Theme {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof Theme, unknown>>;
  return {
    mode: (MODES as readonly unknown[]).includes(raw.mode) ? raw.mode as ThemeMode : DEFAULT_THEME.mode,
    accent: ACCENTS.some((accent) => accent.id === raw.accent) ? raw.accent as Accent : DEFAULT_THEME.accent,
  };
}

// The default (dark + orange) adds no class, so it renders the original design.
export function themeClasses(theme: Theme) {
  return [theme.mode === "light" ? "theme-light" : "", theme.accent === "orange" ? "" : `accent-${theme.accent}`].filter(Boolean);
}

export function applyTheme(theme: Theme, root: HTMLElement) {
  for (const name of [...root.classList]) if (name === "theme-light" || name.startsWith("accent-")) root.classList.remove(name);
  root.classList.add(...themeClasses(theme));
}

export function readTheme(): Theme {
  try { return parseTheme(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null")); }
  catch { return DEFAULT_THEME; }
}

const THEME_EVENT = "whatwas-theme";
let memoryTheme = "";

export function saveTheme(theme: Theme) {
  memoryTheme = JSON.stringify(theme);
  try { localStorage.setItem(THEME_STORAGE_KEY, memoryTheme); } catch { /* The choice just won't persist. */ }
  window.dispatchEvent(new Event(THEME_EVENT));
}

// useSyncExternalStore plumbing: a string snapshot keeps it referentially stable.
export function subscribeTheme(listener: () => void) {
  window.addEventListener(THEME_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(THEME_EVENT, listener); window.removeEventListener("storage", listener); };
}
export function themeSnapshot() {
  try { return localStorage.getItem(THEME_STORAGE_KEY) ?? memoryTheme; } catch { return memoryTheme; }
}
export const serverThemeSnapshot = () => "";

// Runs in <head> before first paint so a saved light theme doesn't flash dark.
export const THEME_BOOT_SCRIPT = `try{var t=JSON.parse(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||"null")||{};var c=document.documentElement.classList;if(t.mode==="light")c.add("theme-light");if(${JSON.stringify(ACCENTS.map((accent) => accent.id).filter((id) => id !== "orange"))}.indexOf(t.accent)>=0)c.add("accent-"+t.accent)}catch(e){}`;
