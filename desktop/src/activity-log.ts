// In-memory logs of what happened on this PC: which window was in front, and
// which files were saved. Kept for a limited time; the web app asks for the
// slice that matches the minutes it exports.

export type WindowEntry = { at: number; app: string; title: string };
export type FileSaveEntry = { at: number; path: string };
export type Activity = { windows: WindowEntry[]; fileSaves: FileSaveEntry[] };

export const KEEP_MS = 2 * 60 * 60 * 1_000;

export class ActivityLog {
  private windows: WindowEntry[] = [];
  private fileSaves: FileSaveEntry[] = [];

  // Only a change of window is worth an entry.
  recordWindow(entry: WindowEntry) {
    const last = this.windows.at(-1);
    if (last && last.app === entry.app && last.title === entry.title) return false;
    this.windows.push(entry);
    this.prune(entry.at);
    return true;
  }

  // Editors often write a file several times per save; keep one entry.
  recordFileSave(entry: FileSaveEntry, mergeWithinMs = 1_000) {
    const recent = this.fileSaves.findLast((save) => save.path === entry.path);
    if (recent && entry.at - recent.at < mergeWithinMs) { recent.at = entry.at; return false; }
    this.fileSaves.push(entry);
    this.prune(entry.at);
    return true;
  }

  // The window already in front when the range starts belongs to the range too.
  slice(since: number, until: number): Activity {
    const startIndex = this.windows.findLastIndex((entry) => entry.at <= since);
    return {
      windows: this.windows.slice(Math.max(0, startIndex)).filter((entry) => entry.at <= until),
      fileSaves: this.fileSaves.filter((entry) => entry.at >= since && entry.at <= until),
    };
  }

  private prune(now: number) {
    const cutoff = now - KEEP_MS;
    // Keep the last window before the cutoff: it was still in front afterwards.
    const firstKept = this.windows.findIndex((entry) => entry.at >= cutoff);
    if (firstKept > 1) this.windows.splice(0, firstKept - 1);
    this.fileSaves = this.fileSaves.filter((entry) => entry.at >= cutoff);
  }
}

const IGNORED = /(^|[\\/])(node_modules|\.git|\.next|dist|out|build|release|\.venv|__pycache__)([\\/]|$)|~$|\.tmp$|\.swp$/i;
export const ignoredPath = (relativePath: string) => IGNORED.test(relativePath);
