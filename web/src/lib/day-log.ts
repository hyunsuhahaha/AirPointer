// Today's work timeline. While screen sharing is on, the workspace collects a
// frame whenever the scene changes and, every few minutes (the user picks how
// many), asks AI what the main work of that stretch was and what interrupted
// it: "A프로젝트 결제 API 수정 · 중간에 카톡 3분, 뉴스 2분". Consecutive
// stretches with the same main work merge. Everything here is a pure function
// over a DayLog; storage lives in day-log-store.ts.

export const ACTIVITY_CATEGORIES = ["dev", "docs", "video", "meeting", "chat", "design", "browse", "other"] as const;
export type ActivityCategory = typeof ACTIVITY_CATEGORIES[number];
export const CATEGORY_NAMES: Record<ActivityCategory, string> = {
  dev: "개발", docs: "문서", video: "영상", meeting: "회의", chat: "소통", design: "디자인", browse: "웹 탐색", other: "기타",
};

export const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  dev: "#ff6b22", docs: "#5b9dff", video: "#f2476a", meeting: "#a78bfa", chat: "#2fc58f", design: "#f06bc4", browse: "#e8c547", other: "#8f8d86",
};

export const RECORD_INTERVALS = [5, 10, 15, 30, 60] as const;
export const DEFAULT_RECORD_INTERVAL = 15;
export const MAX_FRAMES_PER_RECORD = 8;
export const RETENTION_DAYS = [1, 7, 30] as const;

export type DaySession = { startedAt: number; endedAt: number; surface: string };
export type DaySide = { label: string; minutes: number };
// One recorded stretch: what the AI saw across its frames.
export type DayRecord = {
  startedAt: number; endedAt: number;
  category: ActivityCategory; label: string; app: string;
  side: DaySide[]; thumbId: string | null;
};
export type DayBookmark = { id: string; at: number; note: string; thumbId: string | null };
export type DayLog = {
  date: string; // YYYY-MM-DD, local time
  sessions: DaySession[];
  records: DayRecord[];
  bookmarks: DayBookmark[];
};
export type DaySegment = {
  startedAt: number; endedAt: number;
  category: ActivityCategory; label: string; app: string;
  side: DaySide[]; thumbIds: string[]; bookmarks: DayBookmark[];
};

export type ActivityFrame = { time: string; image: string };
export type ActivityRequest = { frames: ActivityFrame[]; minutes: number; previous: string[] };
export type ActivityResult = { category: ActivityCategory; label: string; app: string; side: DaySide[] };

const isFrame = (frame: unknown): frame is ActivityFrame => {
  if (!frame || typeof frame !== "object") return false;
  const { time, image } = frame as Record<string, unknown>;
  return typeof time === "string" && /^\d{2}:\d{2}$/.test(time)
    && typeof image === "string" && image.startsWith("data:image/jpeg;base64,") && image.length <= 400_000;
};

export function isActivityRequest(value: unknown): value is ActivityRequest {
  if (!value || typeof value !== "object") return false;
  const { frames, minutes, previous } = value as Record<string, unknown>;
  return Array.isArray(frames) && frames.length >= 1 && frames.length <= MAX_FRAMES_PER_RECORD && frames.every(isFrame)
    && typeof minutes === "number" && minutes > 0 && minutes <= 120
    && Array.isArray(previous) && previous.length <= 3 && previous.every((item) => typeof item === "string" && item.length <= 60);
}

const pad = (value: number) => String(value).padStart(2, "0");

export function dateKey(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dayStart(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}

export const clockLabel = (at: number) => { const date = new Date(at); return `${pad(date.getHours())}:${pad(date.getMinutes())}`; };

export function durationLabel(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes}분`;
  return minutes % 60 ? `${hours}시간 ${minutes % 60}분` : `${hours}시간`;
}

export const emptyDay = (date: string): DayLog => ({ date, sessions: [], records: [], bookmarks: [] });

// Older records (and anything odd from storage) get the current shape.
export function normalizeDay(value: Partial<DayLog> & { date: string }): DayLog {
  return { date: value.date, sessions: value.sessions ?? [], records: value.records ?? [], bookmarks: value.bookmarks ?? [] };
}

// A session starts when sharing starts and is extended on every tick, so a
// crash or a closed tab still leaves the last known end.
export function touchSession(day: DayLog, startedAt: number, at: number, surface: string): DayLog {
  const from = Math.max(startedAt, dayStart(day.date));
  const sessions = day.sessions.filter((session) => session.startedAt !== from);
  sessions.push({ startedAt: from, endedAt: at, surface });
  sessions.sort((left, right) => left.startedAt - right.startedAt);
  return { ...day, sessions };
}

export const addRecord = (day: DayLog, record: DayRecord): DayLog =>
  ({ ...day, records: [...day.records, record].sort((left, right) => left.startedAt - right.startedAt) });
export const addBookmark = (day: DayLog, bookmark: DayBookmark): DayLog =>
  ({ ...day, bookmarks: [...day.bookmarks, bookmark].sort((left, right) => left.at - right.at) });
export const renameBookmark = (day: DayLog, id: string, note: string): DayLog =>
  ({ ...day, bookmarks: day.bookmarks.map((bookmark) => bookmark.id === id ? { ...bookmark, note } : bookmark) });
export const removeBookmark = (day: DayLog, id: string): DayLog =>
  ({ ...day, bookmarks: day.bookmarks.filter((bookmark) => bookmark.id !== id) });

const overlaps = (record: DayRecord, from: number, to: number) => record.startedAt < to && record.endedAt > from;

// Renames every record of a segment, so a wrong AI guess can be corrected once.
export function renameSegment(day: DayLog, segment: Pick<DaySegment, "startedAt" | "endedAt">, label: string): DayLog {
  return { ...day, records: day.records.map((record) => overlaps(record, segment.startedAt, segment.endedAt) ? { ...record, label } : record) };
}

// Drops everything recorded in [from, to) and trims sessions. Returns the
// thumbnail ids that are no longer referenced so storage can delete them.
export function removeRange(day: DayLog, from: number, to: number): { day: DayLog; removedThumbs: string[] } {
  const sessions = day.sessions.flatMap((session) => [
    { ...session, endedAt: Math.min(session.endedAt, from) },
    { ...session, startedAt: Math.max(session.startedAt, to) },
  ]).filter((session) => session.endedAt - session.startedAt >= 60_000);
  const removedRecords = day.records.filter((record) => overlaps(record, from, to));
  const removedBookmarks = day.bookmarks.filter((bookmark) => bookmark.at >= from && bookmark.at < to);
  return {
    day: {
      ...day, sessions,
      records: day.records.filter((record) => !removedRecords.includes(record)),
      bookmarks: day.bookmarks.filter((bookmark) => !removedBookmarks.includes(bookmark)),
    },
    removedThumbs: [...removedRecords, ...removedBookmarks].map((item) => item.thumbId).filter((id): id is string => Boolean(id)),
  };
}

export function recordedMs(day: DayLog) {
  return day.sessions.reduce((total, session) => total + Math.max(0, session.endedAt - session.startedAt), 0);
}

const sameLabel = (left: string, right: string) => left.replace(/\s+/g, "").toLowerCase() === right.replace(/\s+/g, "").toLowerCase();

function mergeSide(side: DaySide[]) {
  const merged: DaySide[] = [];
  for (const item of side) {
    const existing = merged.find((entry) => sameLabel(entry.label, item.label));
    if (existing) existing.minutes += item.minutes;
    else merged.push({ ...item });
  }
  return merged.sort((left, right) => right.minutes - left.minutes);
}

// Consecutive records with the same main work become one segment; their
// interruptions add up.
export function segmentsOf(day: DayLog): DaySegment[] {
  const segments: DaySegment[] = [];
  for (const record of day.records) {
    const previous = segments.at(-1);
    if (previous && previous.category === record.category && sameLabel(previous.label, record.label) && record.startedAt - previous.endedAt <= 60_000) {
      previous.endedAt = Math.max(previous.endedAt, record.endedAt);
      previous.side = mergeSide([...previous.side, ...record.side]);
      if (record.thumbId) previous.thumbIds.push(record.thumbId);
      continue;
    }
    segments.push({
      startedAt: record.startedAt, endedAt: record.endedAt,
      category: record.category, label: record.label, app: record.app,
      side: mergeSide(record.side), thumbIds: record.thumbId ? [record.thumbId] : [], bookmarks: [],
    });
  }
  return segments.map((segment) => ({
    ...segment,
    bookmarks: day.bookmarks.filter((bookmark) => bookmark.at >= segment.startedAt && bookmark.at < segment.endedAt),
  }));
}

export function categoryTotals(segments: DaySegment[]) {
  const totals = new Map<ActivityCategory, number>();
  for (const segment of segments) totals.set(segment.category, (totals.get(segment.category) ?? 0) + segment.endedAt - segment.startedAt);
  return [...totals].map(([category, ms]) => ({ category, ms })).sort((left, right) => right.ms - left.ms);
}

export const sideLabel = (side: DaySide[]) => side.map((item) => `${item.label} ${item.minutes}분`).join(" · ");

// Up to `count` items spread evenly, always keeping the first and last.
export function pickEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  if (count <= 1) return items.slice(-1);
  return Array.from({ length: count }, (_, index) => items[Math.round((index * (items.length - 1)) / (count - 1))]);
}

export function expiredDates(dates: string[], today: string, keepDays: number) {
  const cutoff = dayStart(today) - (keepDays - 1) * 86_400_000;
  return dates.filter((date) => dayStart(date) < cutoff);
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const escapeInline = (text: string) => text.replace(/[|*_`]/g, "\\$&").replace(/\n/g, " ");

// `thumbUrl` decides how images are linked: a relative file path when saving
// to a folder, an inline data URL for a single downloaded file, or null.
export function dayMarkdown(day: DayLog, thumbUrl: (thumbId: string) => string | null) {
  const segments = segmentsOf(day);
  const date = new Date(dayStart(day.date));
  const worked = segments.reduce((total, segment) => total + segment.endedAt - segment.startedAt, 0);
  const lines = [
    `# ${day.date} (${WEEKDAYS[date.getDay()]}) 작업 타임라인`,
    "",
    `활동 ${durationLabel(worked)} · ${segments.length}개 활동 · 북마크 ${day.bookmarks.length}개`,
    "",
    "## 한눈에 보기",
    "",
  ];
  if (!segments.length) lines.push("기록된 활동이 없습니다.");
  for (const segment of segments) {
    lines.push(`- **${clockLabel(segment.startedAt)}–${clockLabel(segment.endedAt)}** ${escapeInline(segment.label)}`);
    if (segment.side.length) lines.push(`  - 중간에: ${escapeInline(sideLabel(segment.side))}`);
  }
  const totals = categoryTotals(segments);
  if (totals.length) {
    lines.push("", "## 분류별 시간", "", "| 분류 | 시간 | 비율 |", "|---|---|---|");
    for (const total of totals) lines.push(`| ${CATEGORY_NAMES[total.category]} | ${durationLabel(total.ms)} | ${Math.round((total.ms / worked) * 100)}% |`);
  }
  if (segments.length) {
    lines.push("", "## 상세 타임라인", "", "| 시간 | 길이 | 주로 한 일 | 분류 | 앱 | 중간에 한 일 |", "|---|---|---|---|---|---|");
    for (const segment of segments) {
      lines.push(`| ${clockLabel(segment.startedAt)}–${clockLabel(segment.endedAt)} | ${durationLabel(segment.endedAt - segment.startedAt)} | ${escapeInline(segment.label)} | ${CATEGORY_NAMES[segment.category]} | ${escapeInline(segment.app) || "-"} | ${escapeInline(sideLabel(segment.side)) || "-"} |`);
    }
    const shots = segments.flatMap((segment) => {
      const url = segment.thumbIds[0] ? thumbUrl(segment.thumbIds[0]) : null;
      return url ? [`![${clockLabel(segment.startedAt)} ${escapeInline(segment.label)}](${url})`, ""] : [];
    });
    if (shots.length) lines.push("", "## 활동별 대표 화면", "", ...shots);
  }
  if (day.bookmarks.length) {
    lines.push("", "## 북마크", "");
    for (const bookmark of day.bookmarks) {
      lines.push(`- **${clockLabel(bookmark.at)}** ${escapeInline(bookmark.note) || "북마크"}`);
      const url = bookmark.thumbId ? thumbUrl(bookmark.thumbId) : null;
      if (url) lines.push(`  ![${clockLabel(bookmark.at)} 북마크 화면](${url})`);
    }
  }
  lines.push("", "---", "", "화면 공유를 켜 둔 동안 방금그거뭐였지가 기록했습니다. 활동 이름과 시간은 AI가 화면 장면을 보고 추정한 것이라 틀릴 수 있습니다.");
  return `${lines.join("\n")}\n`;
}
