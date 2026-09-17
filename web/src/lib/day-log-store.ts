// Keeps day timelines in this browser's IndexedDB so they survive closing the
// tab or restarting the PC. Thumbnails live in their own store so saving the
// day record every tick doesn't rewrite images.

import { dateKey, emptyDay, expiredDates, normalizeDay } from "./day-log.ts";
import type { DayLog } from "./day-log.ts";

const DB_NAME = "whatwas-day-log";
const DAYS = "days";
const THUMBS = "thumbs";
type StoredThumb = { id: string; date: string; dataUrl: string };

let dbPromise: Promise<IDBDatabase> | null = null;

const DAY_LOG_EVENT = "whatwas-day-log-changed";
export const notifyDayLog = () => window.dispatchEvent(new Event(DAY_LOG_EVENT));
export function onDayLogChange(listener: () => void) {
  window.addEventListener(DAY_LOG_EVENT, listener);
  return () => window.removeEventListener(DAY_LOG_EVENT, listener);
}

function openDb() {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(DAYS, { keyPath: "date" });
      db.createObjectStore(THUMBS, { keyPath: "id" }).createIndex("date", "date");
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); dbPromise = null; };
      resolve(request.result);
    };
    request.onerror = () => { dbPromise = null; reject(request.error ?? new Error("타임라인 저장소를 열지 못했습니다.")); };
  });
  return dbPromise;
}

async function run<T>(stores: string[], mode: IDBTransactionMode, work: (transaction: IDBTransaction) => IDBRequest<T> | void) {
  const transaction = (await openDb()).transaction(stores, mode);
  const request = work(transaction);
  return new Promise<T | undefined>((resolve, reject) => {
    transaction.oncomplete = () => resolve(request ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function loadDay(date: string): Promise<DayLog> {
  const stored = await run<DayLog>([DAYS], "readonly", (tx) => tx.objectStore(DAYS).get(date));
  return stored ? normalizeDay(stored) : emptyDay(date);
}

export async function saveDay(day: DayLog) {
  await run([DAYS], "readwrite", (tx) => { tx.objectStore(DAYS).put(day); });
}

export async function listDates(): Promise<string[]> {
  const keys = await run<IDBValidKey[]>([DAYS], "readonly", (tx) => tx.objectStore(DAYS).getAllKeys());
  return (keys ?? []).map(String).sort().reverse();
}

export async function saveThumb(id: string, dataUrl: string, at: number) {
  await run([THUMBS], "readwrite", (tx) => { tx.objectStore(THUMBS).put({ id, date: dateKey(at), dataUrl } satisfies StoredThumb); });
}

export async function loadThumbs(date: string): Promise<Record<string, string>> {
  const rows = await run<StoredThumb[]>([THUMBS], "readonly", (tx) => tx.objectStore(THUMBS).index("date").getAll(date));
  return Object.fromEntries((rows ?? []).map((row) => [row.id, row.dataUrl]));
}

export async function deleteThumbs(ids: string[]) {
  if (!ids.length) return;
  await run([THUMBS], "readwrite", (tx) => { for (const id of ids) tx.objectStore(THUMBS).delete(id); });
}

export async function deleteDay(date: string) {
  await run([DAYS, THUMBS], "readwrite", (tx) => {
    tx.objectStore(DAYS).delete(date);
    const cursor = tx.objectStore(THUMBS).index("date").openKeyCursor(IDBKeyRange.only(date));
    cursor.onsuccess = () => { if (cursor.result) { tx.objectStore(THUMBS).delete(cursor.result.primaryKey); cursor.result.continue(); } };
  });
}

export async function pruneDays(keepDays: number, now = Date.now()) {
  for (const date of expiredDates(await listDates(), dateKey(now), keepDays)) await deleteDay(date);
}

// Ask the browser not to evict this data under storage pressure.
export async function requestPersistence() {
  try { return await navigator.storage?.persist?.() ?? false; } catch { return false; }
}

export async function storageUsage() {
  try { return (await navigator.storage?.estimate?.())?.usage ?? null; } catch { return null; }
}

// A JPEG of the shared screen: small for the timeline, larger for AI.
export function thumbFromVideo(video: HTMLVideoElement, width: number, quality: number) {
  const w = Math.min(width, Math.max(1, video.videoWidth));
  const h = Math.max(1, Math.round(w * video.videoHeight / Math.max(1, video.videoWidth)));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", quality);
}

// 16x9 grayscale sample; two screens differ when many cells moved.
export function screenFingerprint(video: HTMLVideoElement) {
  const canvas = document.createElement("canvas");
  canvas.width = 16; canvas.height = 9;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(video, 0, 0, 16, 9);
  const pixels = context.getImageData(0, 0, 16, 9).data;
  const cells: number[] = [];
  for (let index = 0; index < pixels.length; index += 4) cells.push((pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3);
  return cells;
}

export function fingerprintChange(left: number[] | null, right: number[]) {
  if (!left || left.length !== right.length) return 1;
  return left.filter((value, index) => Math.abs(value - right[index]) > 24).length / left.length;
}
