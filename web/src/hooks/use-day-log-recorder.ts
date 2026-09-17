"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { DEFAULT_RECORD_INTERVAL, MAX_FRAMES_PER_RECORD, RECORD_INTERVALS, addBookmark, addRecord, clockLabel, dateKey, pickEvenly, touchSession } from "@/lib/day-log";
import type { ActivityResult, DayLog } from "@/lib/day-log";
import { fingerprintChange, loadDay, notifyDayLog, pruneDays, saveDay, saveThumb, screenFingerprint, thumbFromVideo } from "@/lib/day-log-store";
import type { BrowserReplayBuffer } from "@/lib/replay-buffer";

const TICK_MS = 20_000;
// Share of the 16x9 screen sample that must change to count as a new scene.
const SCENE_CHANGE = 0.3;
const MAX_HELD_FRAMES = 48;
const RETENTION_KEY = "whatwas-day-timeline-days";
const INTERVAL_KEY = "whatwas-day-timeline-interval";
const AUTOSAVE_KEY = "whatwas-day-timeline-autosave";
const SETTINGS_EVENT = "whatwas-day-timeline-settings";

function readSetting(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writeSetting(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* private mode: keep for this page only */ }
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}

function useSetting(key: string) {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(SETTINGS_EVENT, onChange);
      return () => { window.removeEventListener("storage", onChange); window.removeEventListener(SETTINGS_EVENT, onChange); };
    },
    () => readSetting(key),
    () => null,
  );
}

export function useDayTimelineSettings() {
  const retention = Number(useSetting(RETENTION_KEY)) || 7;
  const storedInterval = Number(useSetting(INTERVAL_KEY));
  const interval = RECORD_INTERVALS.find((minutes) => minutes === storedInterval) ?? DEFAULT_RECORD_INTERVAL;
  const autoSave = useSetting(AUTOSAVE_KEY) === "1";
  return {
    retention, interval, autoSave,
    setRetention: (days: number) => writeSetting(RETENTION_KEY, String(days)),
    setInterval: (minutes: number) => writeSetting(INTERVAL_KEY, String(minutes)),
    setAutoSave: (value: boolean) => writeSetting(AUTOSAVE_KEY, value ? "1" : "0"),
  };
}

export type RecorderStatus = { state: "idle" | "working" | "error"; message: string; nextAt: number | null; held: number };
type HeldFrame = { at: number; image: string; thumb: string };
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function requestRecord(frames: HeldFrame[], minutes: number, previous: string[]) {
  const response = await fetch("/api/activity-label", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ frames: frames.map((frame) => ({ time: clockLabel(frame.at), image: frame.image })), minutes, previous }),
  });
  const body = await response.json().catch(() => ({})) as Partial<ActivityResult> & { error?: string };
  if (!response.ok || !body.category || !body.label) throw Object.assign(new Error(body.error || "활동을 정리하지 못했습니다."), { status: response.status });
  return { category: body.category, label: body.label, app: body.app ?? "", side: body.side ?? [] };
}

// While sharing (and the timeline is on), keeps a frame each time the scene
// changes and, every `interval` minutes, asks AI to sum that stretch up as
// "main work + interruptions". Frames stay in memory until then; only the
// record and one small thumbnail are stored. Returns the status and a
// bookmark function for the PiP button.
export function useDayLogRecorder({ enabled, retention, interval, stream, videoRef, bufferRef }: {
  enabled: boolean; retention: number; interval: number; stream: MediaStream | null;
  videoRef: RefObject<HTMLVideoElement | null>; bufferRef: RefObject<BrowserReplayBuffer>;
}) {
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [status, setStatus] = useState<RecorderStatus>({ state: "idle", message: "", nextAt: null, held: 0 });

  const update = useCallback((change: (day: DayLog, now: number) => DayLog | Promise<DayLog>) => {
    queue.current = queue.current.then(async () => {
      const now = Date.now();
      const day = await loadDay(dateKey(now));
      await saveDay(await change(day, now));
      notifyDayLog();
    }).catch(() => undefined);
    return queue.current;
  }, []);

  useEffect(() => { void pruneDays(retention).then(notifyDayLog).catch(() => undefined); }, [retention]);

  useEffect(() => {
    if (!enabled || !stream) return;
    const sessionStart = Date.now();
    const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface ?? "unknown";
    const intervalMs = interval * 60_000;
    let windowStart = sessionStart;
    let frames: HeldFrame[] = [];
    let lastScene: number[] | null = null;
    let lastFrameAt = 0;
    let sceneChanges = 0;
    let broken = false;

    const hold = () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;
      const now = Date.now();
      const scene = screenFingerprint(video);
      const changed = fingerprintChange(lastScene, scene) >= SCENE_CHANGE;
      // A new scene, or a steady screen sampled a few times per stretch.
      if (!changed && now - lastFrameAt < intervalMs / 4) return;
      if (changed && lastScene) sceneChanges += 1;
      lastScene = scene; lastFrameAt = now;
      frames.push({ at: now, image: thumbFromVideo(video, 960, 0.5), thumb: thumbFromVideo(video, 480, 0.62) });
      if (frames.length > MAX_HELD_FRAMES) frames = frames.filter((_, index) => index === 0 || index % 2 === 1);
    };

    // Nothing moved on screen for the whole stretch: away from the desk.
    const record = async (from: number, to: number, held: HeldFrame[], changes: number) => {
      const quiet = changes === 0 && bufferRef.current.changesEndedAfter(from).length === 0;
      if (broken || !held.length || to - from < 60_000 || quiet) return;
      setStatus((current) => ({ ...current, state: "working", message: `${clockLabel(from)}–${clockLabel(to)} 장면 ${held.length}개 정리 중`, nextAt: to + intervalMs }));
      try {
        const day = await loadDay(dateKey(from));
        const previous = [...new Set(day.records.slice(-3).map((item) => item.label).reverse())];
        const picked = pickEvenly(held, MAX_FRAMES_PER_RECORD);
        const result = await requestRecord(picked, Math.round((to - from) / 60_000), previous);
        const thumbId = newId();
        await saveThumb(thumbId, picked[Math.floor(picked.length / 2)].thumb, from);
        await update((current) => addRecord(current, { startedAt: from, endedAt: to, ...result, thumbId }));
        setStatus((current) => ({ ...current, state: "idle", message: `${clockLabel(from)} ${result.label}`, nextAt: to + intervalMs }));
      } catch (reason) {
        const code = (reason as { status?: number }).status;
        // A missing key or a rejected request won't fix itself.
        if (code === 503 || code === 400) broken = true;
        setStatus((current) => ({ ...current, state: "error", message: reason instanceof Error ? reason.message : "활동을 정리하지 못했습니다.", nextAt: broken ? null : to + intervalMs }));
      }
    };

    const flush = (now: number) => {
      const held = frames, from = windowStart, changes = sceneChanges;
      frames = []; windowStart = now; lastFrameAt = 0; sceneChanges = 0;
      void record(from, now, held, changes);
    };

    const tick = () => {
      const now = Date.now();
      void update((day) => touchSession(day, sessionStart, now, surface));
      hold();
      setStatus((current) => current.nextAt === windowStart + intervalMs && current.held === frames.length ? current : { ...current, nextAt: windowStart + intervalMs, held: frames.length });
      if (now - windowStart >= intervalMs || dateKey(now) !== dateKey(windowStart)) flush(now);
    };
    const first = window.setTimeout(tick, 2_000);
    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearTimeout(first); window.clearInterval(timer);
      const now = Date.now();
      void update((day) => touchSession(day, sessionStart, now, surface));
      flush(now);
      setStatus({ state: "idle", message: "", nextAt: null, held: 0 });
    };
  }, [bufferRef, enabled, interval, stream, update, videoRef]);

  const bookmark = useCallback(() => {
    const video = videoRef.current;
    if (!enabled || !stream || !video || video.readyState < 2) return;
    const at = Date.now();
    const thumbId = newId();
    const thumb = thumbFromVideo(video, 480, 0.62);
    void update(async (day) => { await saveThumb(thumbId, thumb, at); return addBookmark(day, { id: newId(), at, note: "", thumbId }); });
  }, [enabled, stream, update, videoRef]);

  return { bookmark, status };
}
