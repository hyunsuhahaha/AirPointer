export type MemoryFrameSource = "timeline" | "bookmark" | "capture" | "demo";

export type ScreenMemoryFrame = {
  id: string;
  capturedAt: number;
  imageUrl: string;
  text: string;
  source: MemoryFrameSource;
  surface: "browser" | "window" | "monitor" | "unknown";
  width: number;
  height: number;
  bookmarked: boolean;
  note: string;
  tags: string[];
};

export type ScreenMemoryReport = {
  id: string;
  createdAt: number;
  from: number;
  to: number;
  title: string;
  markdown: string;
  automatic: boolean;
};

export type ScreenMemorySummary = {
  from: number;
  to: number;
  activeMinutes: number;
  frameCount: number;
  bookmarkCount: number;
  captureCount: number;
  topTags: Array<{ tag: string; count: number }>;
  sources: Array<{ source: MemoryFrameSource; count: number }>;
};

const DB_NAME = "airpointer-screen-memory";
const DB_VERSION = 1;
const FRAME_STORE = "frames";
const REPORT_STORE = "reports";
const MAX_FRAMES = 500;
const memoryEvents = typeof EventTarget === "undefined" ? null : new EventTarget();
let memoryFallback: ScreenMemoryFrame[] = [];
let reportFallback: ScreenMemoryReport[] = [];
let memoryDbPromise: Promise<IDBDatabase | null> | null = null;

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("로컬 화면 기억을 읽지 못했습니다."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("로컬 화면 기억을 저장하지 못했습니다."));
    transaction.onabort = () => reject(transaction.error ?? new Error("로컬 화면 기억 저장이 중단됐습니다."));
  });
}

async function openMemoryDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  if (!memoryDbPromise) memoryDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FRAME_STORE)) {
        const frames = db.createObjectStore(FRAME_STORE, { keyPath: "id" });
        frames.createIndex("capturedAt", "capturedAt");
        frames.createIndex("bookmarked", "bookmarked");
      }
      if (!db.objectStoreNames.contains(REPORT_STORE)) {
        const reports = db.createObjectStore(REPORT_STORE, { keyPath: "id" });
        reports.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); memoryDbPromise = null; };
      resolve(request.result);
    };
    request.onerror = () => { memoryDbPromise = null; reject(request.error ?? new Error("로컬 화면 기억을 열지 못했습니다.")); };
  });
  return memoryDbPromise;
}

function changed() {
  memoryEvents?.dispatchEvent(new Event("change"));
}

export function subscribeScreenMemory(listener: () => void): () => void {
  memoryEvents?.addEventListener("change", listener);
  return () => memoryEvents?.removeEventListener("change", listener);
}

export async function saveScreenMemoryFrame(input: Omit<ScreenMemoryFrame, "id"> & { id?: string }): Promise<ScreenMemoryFrame> {
  const frame: ScreenMemoryFrame = { ...input, id: input.id ?? crypto.randomUUID(), tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 12) };
  const db = await openMemoryDb();
  if (!db) {
    memoryFallback = [...memoryFallback.filter((item) => item.id !== frame.id), frame].sort((a, b) => b.capturedAt - a.capturedAt).slice(0, MAX_FRAMES);
    changed();
    return frame;
  }
  const transaction = db.transaction(FRAME_STORE, "readwrite");
  transaction.objectStore(FRAME_STORE).put(frame);
  await transactionDone(transaction);
  await pruneFrames();
  changed();
  return frame;
}

export async function updateScreenMemoryFrame(id: string, patch: Partial<Pick<ScreenMemoryFrame, "text" | "bookmarked" | "note" | "tags">>): Promise<ScreenMemoryFrame | null> {
  const current = await getScreenMemoryFrame(id);
  if (!current) return null;
  return saveScreenMemoryFrame({ ...current, ...patch, id, tags: patch.tags ?? current.tags });
}

export async function getScreenMemoryFrame(id: string): Promise<ScreenMemoryFrame | null> {
  const db = await openMemoryDb();
  if (!db) return memoryFallback.find((frame) => frame.id === id) ?? null;
  const transaction = db.transaction(FRAME_STORE, "readonly");
  const result = await requestValue(transaction.objectStore(FRAME_STORE).get(id)) as ScreenMemoryFrame | undefined;
  return result ?? null;
}

export async function listScreenMemoryFrames(options: { query?: string; from?: number; to?: number; source?: MemoryFrameSource | "all"; bookmarked?: boolean; limit?: number } = {}): Promise<ScreenMemoryFrame[]> {
  const db = await openMemoryDb();
  let frames: ScreenMemoryFrame[];
  if (!db) frames = [...memoryFallback];
  else {
    const transaction = db.transaction(FRAME_STORE, "readonly");
    frames = await requestValue(transaction.objectStore(FRAME_STORE).getAll()) as ScreenMemoryFrame[];
  }
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  return frames
    .filter((frame) => options.from === undefined || frame.capturedAt >= options.from)
    .filter((frame) => options.to === undefined || frame.capturedAt <= options.to)
    .filter((frame) => !options.source || options.source === "all" || frame.source === options.source)
    .filter((frame) => options.bookmarked === undefined || frame.bookmarked === options.bookmarked)
    .filter((frame) => !query || `${frame.text}\n${frame.note}\n${frame.tags.join(" ")}`.toLocaleLowerCase().includes(query))
    .sort((a, b) => b.capturedAt - a.capturedAt)
    .slice(0, options.limit ?? 120);
}

export async function deleteScreenMemoryFrame(id: string): Promise<void> {
  const db = await openMemoryDb();
  if (!db) memoryFallback = memoryFallback.filter((frame) => frame.id !== id);
  else {
    const transaction = db.transaction(FRAME_STORE, "readwrite");
    transaction.objectStore(FRAME_STORE).delete(id);
    await transactionDone(transaction);
  }
  changed();
}

async function pruneFrames() {
  const db = await openMemoryDb();
  if (!db) return;
  const read = db.transaction(FRAME_STORE, "readonly");
  const frames = await requestValue(read.objectStore(FRAME_STORE).getAll()) as ScreenMemoryFrame[];
  const expired = frames.filter((frame) => !frame.bookmarked).sort((a, b) => b.capturedAt - a.capturedAt).slice(MAX_FRAMES);
  if (expired.length) {
    const write = db.transaction(FRAME_STORE, "readwrite");
    const done = transactionDone(write);
    for (const frame of expired) write.objectStore(FRAME_STORE).delete(frame.id);
    await done;
  }
}

export async function screenMemorySummary(from: number, to = Date.now()): Promise<ScreenMemorySummary> {
  const frames = await listScreenMemoryFrames({ from, to, limit: MAX_FRAMES });
  const tagCounts = new Map<string, number>();
  const sourceCounts = new Map<MemoryFrameSource, number>();
  for (const frame of frames) {
    sourceCounts.set(frame.source, (sourceCounts.get(frame.source) ?? 0) + 1);
    for (const tag of frame.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const times = [...frames].sort((a, b) => a.capturedAt - b.capturedAt).map((frame) => frame.capturedAt);
  let activeMs = 0;
  for (let index = 1; index < times.length; index += 1) activeMs += Math.min(15_000, times[index] - times[index - 1]);
  return {
    from, to, activeMinutes: Math.round(activeMs / 600) / 100, frameCount: frames.length,
    bookmarkCount: frames.filter((frame) => frame.bookmarked).length,
    captureCount: frames.filter((frame) => frame.source === "capture").length,
    topTags: [...tagCounts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    sources: [...sourceCounts].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
  };
}

export function buildDeveloperReport(frames: ScreenMemoryFrame[], from: number, to: number, title = "개발 화면 기록"): string {
  const ordered = [...frames].sort((a, b) => a.capturedAt - b.capturedAt);
  const bookmarks = ordered.filter((frame) => frame.bookmarked);
  const errors = ordered.filter((frame) => /error|exception|failed|오류|실패/i.test(`${frame.text} ${frame.note}`));
  const lines = [
    `# ${title}`,
    "",
    `- 기간: ${new Date(from).toLocaleString("ko-KR")} ~ ${new Date(to).toLocaleString("ko-KR")}`,
    `- 기록 프레임: ${ordered.length}개`,
    `- 북마크: ${bookmarks.length}개`,
    `- 오류 후보: ${errors.length}개`,
    "",
    "## 핵심 시점",
    "",
    ...((bookmarks.length ? bookmarks : errors).slice(0, 20).flatMap((frame, index) => [
      `### ${index + 1}. ${new Date(frame.capturedAt).toLocaleTimeString("ko-KR")}${frame.note ? ` · ${frame.note}` : ""}`,
      "",
      frame.tags.length ? `태그: ${frame.tags.map((tag) => `\`${tag}\``).join(" ")}` : "",
      frame.text ? frame.text.slice(0, 800) : "화면 텍스트 없음",
      "",
    ])),
    "## 재현 메모",
    "",
    "- 예상 동작:",
    "- 실제 동작:",
    "- 재현 단계:",
  ];
  return lines.filter((line, index) => line || lines[index - 1] !== "").join("\n");
}

export async function saveScreenMemoryReport(report: Omit<ScreenMemoryReport, "id" | "createdAt"> & { id?: string; createdAt?: number }): Promise<ScreenMemoryReport> {
  const saved: ScreenMemoryReport = { ...report, id: report.id ?? crypto.randomUUID(), createdAt: report.createdAt ?? Date.now() };
  const db = await openMemoryDb();
  if (!db) reportFallback = [saved, ...reportFallback.filter((item) => item.id !== saved.id)].slice(0, 50);
  else {
    const transaction = db.transaction(REPORT_STORE, "readwrite");
    transaction.objectStore(REPORT_STORE).put(saved);
    await transactionDone(transaction);
  }
  changed();
  return saved;
}

export async function listScreenMemoryReports(limit = 20): Promise<ScreenMemoryReport[]> {
  const db = await openMemoryDb();
  let reports: ScreenMemoryReport[];
  if (!db) reports = [...reportFallback];
  else {
    const transaction = db.transaction(REPORT_STORE, "readonly");
    reports = await requestValue(transaction.objectStore(REPORT_STORE).getAll()) as ScreenMemoryReport[];
  }
  return reports.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

export function memoryFrameFromVideo(video: HTMLVideoElement): { imageUrl: string; width: number; height: number; fingerprint: string } {
  const width = Math.min(960, Math.max(1, video.videoWidth));
  const height = Math.max(1, Math.round(width * video.videoHeight / Math.max(1, video.videoWidth)));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d")!.drawImage(video, 0, 0, width, height);
  const sample = document.createElement("canvas");
  sample.width = 16; sample.height = 9;
  const context = sample.getContext("2d")!;
  context.drawImage(canvas, 0, 0, 16, 9);
  const pixels = context.getImageData(0, 0, 16, 9).data;
  let fingerprint = "";
  for (let index = 0; index < pixels.length; index += 16) fingerprint += String.fromCharCode(Math.round((pixels[index] + pixels[index + 1] + pixels[index + 2]) / 48));
  return { imageUrl: canvas.toDataURL("image/jpeg", 0.62), width, height, fingerprint };
}

export function fingerprintChanged(previous: string, next: string, threshold = 5): boolean {
  if (!previous || previous.length !== next.length) return true;
  let delta = 0;
  for (let index = 0; index < next.length; index += 1) delta += Math.abs(next.charCodeAt(index) - previous.charCodeAt(index));
  return delta / next.length >= threshold;
}
