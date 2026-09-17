import fs from "node:fs";
import path from "node:path";

export type Settings = {
  // Where Local Folder exports go, without asking each time.
  exportDir: string;
  // A project folder whose file saves are recorded; null records none.
  watchDir: string | null;
  shortcut: string;
};

export function loadSettings(file: string, defaults: Settings): Settings {
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<Settings>;
    return {
      exportDir: typeof saved.exportDir === "string" && saved.exportDir ? saved.exportDir : defaults.exportDir,
      watchDir: typeof saved.watchDir === "string" && saved.watchDir ? saved.watchDir : null,
      shortcut: typeof saved.shortcut === "string" && saved.shortcut ? saved.shortcut : defaults.shortcut,
    };
  } catch { return defaults; }
}

export function saveSettings(file: string, settings: Settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}

// Export files come from the web page: keep every path inside the new folder.
export function safeContextPath(root: string, name: string, relative: string) {
  if (!/^[\w.-]+$/.test(name) || name === "." || name === "..") throw new Error("폴더 이름이 올바르지 않습니다.");
  const folder = path.resolve(root, name);
  const target = path.resolve(folder, relative);
  if (!relative || path.isAbsolute(relative) || !target.startsWith(folder + path.sep)) throw new Error("허용되지 않은 파일 경로입니다.");
  return { folder, target };
}
