// Script for the day-timeline usage example. It plays on the real timeline
// screen: scenes pile up, every 15 minutes a line appears (and merges when
// the work continues), the afternoon fast-forwards, one line is opened and
// the day is shown as the Markdown it saves. Everything is a pure function of
// `t`; `dayAt` builds the DayLog the real component renders.

import type { ActivityCategory, DayLog, DaySide } from "./day-log.ts";
import { captionAt as captionIn, within } from "./usage-example-timeline.ts";
import type { Caption } from "./usage-example-timeline.ts";

export const DURATION = 21;
// The script's own record interval (the captions say "N분": the user picks it).
export const INTERVAL = 15;

export const BEATS = {
  flushes: [1, 3.8, 6.2], settles: [1.6, 4.4, 6.8],
  montage: [7.4, 12.4], select: 13.4, md: [15, 19],
} as const;

// Minutes since midnight at each playhead key.
const CLOCK: [number, number][] = [[0, 555], [1, 570], [1.6, 570], [3.8, 585], [4.4, 585], [6.2, 600], [7.4, 600], [12.4, 1050]];
export function clockAt(t: number) {
  if (t <= CLOCK[0][0]) return CLOCK[0][1];
  for (let index = 1; index < CLOCK.length; index++) {
    const [t0, m0] = CLOCK[index - 1];
    const [t1, m1] = CLOCK[index];
    if (t <= t1) return m0 + (m1 - m0) * (t1 > t0 ? (t - t0) / (t1 - t0) : 1);
  }
  return CLOCK.at(-1)![1];
}
export const fastForward = (t: number) => within(t, BEATS.montage);

export type ThumbKind = "code" | "video" | "docs" | "meeting" | "review" | "bug";
type ScriptRecord = { appear: number; from: number; to: number; category: ActivityCategory; label: string; app: string; side: DaySide[]; thumb: ThumbKind };
export const RECORDS: ScriptRecord[] = [
  { appear: 1.6, from: 555, to: 570, category: "dev", label: "A프로젝트 결제 화면 수정", app: "VS Code", side: [{ label: "카톡 업무 연락", minutes: 3 }, { label: "뉴스 보기", minutes: 2 }], thumb: "code" },
  { appear: 4.4, from: 570, to: 585, category: "dev", label: "A프로젝트 결제 화면 수정", app: "VS Code", side: [{ label: "Slack 확인", minutes: 2 }], thumb: "code" },
  { appear: 6.8, from: 585, to: 600, category: "video", label: "유튜브 시청 · React 19 강의", app: "YouTube", side: [], thumb: "video" },
  { appear: 8.2, from: 600, to: 700, category: "docs", label: "분기 보고서 작성", app: "Google Docs", side: [{ label: "카톡 업무 연락", minutes: 4 }], thumb: "docs" },
  { appear: 9.4, from: 780, to: 840, category: "meeting", label: "주간 기획 회의", app: "Zoom", side: [], thumb: "meeting" },
  { appear: 10.6, from: 840, to: 1010, category: "dev", label: "결제 API 버그 수정", app: "Cursor", side: [{ label: "Stack Overflow 검색", minutes: 6 }, { label: "뉴스 보기", minutes: 3 }], thumb: "bug" },
  { appear: 11.8, from: 1010, to: 1050, category: "dev", label: "PR 리뷰 · 결제 모듈", app: "GitHub", side: [], thumb: "review" },
];
export const BOOKMARK = { appear: 10.6, at: 842, note: "결제 금액 불일치 재현", thumb: "bug" as ThumbKind };
export const LUNCH: [number, number] = [720, 780];

// Scenes collected while the screen changed, per 15-minute window.
const CAPTURES = [0.15, 0.4, 0.65, 0.85, 2.2, 2.9, 3.5, 5.0, 5.7];
const WINDOWS: [number, number][] = [[0, 1], [1.6, 3.8], [4.4, 6.2], [6.8, 7.4]];
export const heldAt = (t: number) => {
  const window = WINDOWS.find(([start, end]) => t >= start && t < end);
  return window ? CAPTURES.filter((at) => at >= window[0] && at <= t).length : 0;
};

export type DemoStatus = { state: "idle" | "working" | "error"; message: string; nextAt: number | null; held: number };
const minuteText = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(Math.floor(minutes % 60)).padStart(2, "0")}`;

export function statusAt(t: number, start: number): DemoStatus {
  const now = clockAt(t);
  const nextAt = start + (Math.floor(now / INTERVAL) + 1) * INTERVAL * 60_000;
  const flushing = BEATS.flushes.findIndex((at, index) => t >= at && t < BEATS.settles[index]);
  if (flushing >= 0) {
    const record = RECORDS[flushing];
    const [from, to] = WINDOWS[flushing];
    return { state: "working", message: `${minuteText(record.from)}–${minuteText(record.to)} 장면 ${CAPTURES.filter((at) => at >= from && at < to).length}개 정리 중`, nextAt, held: 0 };
  }
  const last = RECORDS.findLast((record) => t >= record.appear);
  return { state: "idle", message: last ? `${minuteText(last.from)} ${last.label}` : "", nextAt, held: heldAt(t) };
}

export const thumbId = (kind: ThumbKind) => `demo-${kind}`;

export function dayAt(t: number, date: string, start: number): DayLog {
  const now = clockAt(t);
  const at = (minutes: number) => start + minutes * 60_000;
  const sessions = [{ startedAt: at(555), endedAt: at(Math.min(now, LUNCH[0])), surface: "monitor" }];
  if (now > LUNCH[1]) sessions.push({ startedAt: at(LUNCH[1]), endedAt: at(now), surface: "monitor" });
  return {
    date, sessions,
    records: RECORDS.filter((record) => t >= record.appear).map((record) => ({
      startedAt: at(record.from), endedAt: at(record.to), category: record.category, label: record.label, app: record.app, side: record.side, thumbId: thumbId(record.thumb),
    })),
    bookmarks: t >= BOOKMARK.appear ? [{ id: "demo-bookmark", at: at(BOOKMARK.at), note: BOOKMARK.note, thumbId: thumbId(BOOKMARK.thumb) }] : [],
  };
}

export const selectedAt = (t: number, start: number) => t >= BEATS.select && t < BEATS.md[0] ? start + 840 * 60_000 : null;

export function mdAt(t: number) {
  const [from, to] = BEATS.md;
  return { visible: t >= from, progress: Math.min(1, Math.max(0, (t - from) / (to - from))) };
}

export const CAPTIONS: Caption[] = [
  { text: "기록 간격(N분)마다 AI가 “주로 한 일 + 중간에 한 일”로 한 줄 정리", start: 0, end: 3.7 },
  { text: "같은 일이 이어지면 한 줄로 합쳐져요", start: 3.8, end: 6.1 },
  { text: "하는 일이 바뀌면 새 줄", start: 6.2, end: 7.3 },
  { text: "퇴근할 때쯤이면 하루가 이렇게 정리돼 있어요", start: 7.4, end: 13.3 },
  { text: "눌러서 자세히 보고, 이름도 고칠 수 있어요", start: 13.4, end: 14.9 },
  { text: "MD로 저장하면 일일 보고·회고에 바로", start: 15, end: DURATION },
];
export const captionAt = (t: number) => captionIn(CAPTIONS, t);
