"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { BookmarkSimple, CalendarBlank, Check, CircleNotch, Clock, DownloadSimple, FolderOpen, LockKey, PencilSimple, Play, Record, Sparkle, Stop, Trash, WarningCircle } from "@phosphor-icons/react";
import { CATEGORY_COLORS, CATEGORY_NAMES, RECORD_INTERVALS, RETENTION_DAYS, categoryTotals, clockLabel, dateKey, dayMarkdown, dayStart, durationLabel, emptyDay, removeBookmark, removeRange, renameBookmark, renameSegment, segmentsOf, sideLabel } from "@/lib/day-log";
import type { ActivityCategory, DayLog, DaySegment } from "@/lib/day-log";
import { deleteDay, deleteThumbs, listDates, loadDay, loadThumbs, notifyDayLog, onDayLogChange, saveDay, storageUsage } from "@/lib/day-log-store";
import { chooseExportDirectory, savedExportDirectory, writeExportFolder } from "@/lib/export-directory";
import { useDayTimelineSettings } from "@/hooks/use-day-log-recorder";
import type { RecorderStatus } from "@/hooks/use-day-log-recorder";
import styles from "./day-timeline.module.css";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const AUTOSAVE_MS = 10 * MINUTE;
const W = 1000, L = 20, R = 980, LANE_TOP = 30, LANE_H = 34;
type Zoom = "day" | "3h" | "1h";

const thumbFileName = (day: DayLog, id: string) => {
  const at = [...day.records.map((record) => ({ at: record.startedAt, thumbId: record.thumbId })), ...day.bookmarks].find((item) => item.thumbId === id)?.at ?? 0;
  return `thumbs/${clockLabel(at).replace(":", "")}-${id.slice(-6)}.jpg`;
};

async function saveToFolder(day: DayLog, directory: FileSystemDirectoryHandle) {
  const thumbs = await loadThumbs(day.date);
  const used = new Set<string>();
  const markdown = dayMarkdown(day, (id) => { if (!thumbs[id]) return null; used.add(id); return thumbFileName(day, id); });
  const images = await Promise.all([...used].map(async (id) => new File([await (await fetch(thumbs[id])).blob()], thumbFileName(day, id), { type: "image/jpeg" })));
  await writeExportFolder(directory, `Timeline-${day.date}`, [new File([markdown], "timeline.md", { type: "text/markdown" }), ...images]);
}

// Hangul is about 13 units wide at this size, Latin about 7.5.
function fitLabel(label: string, room: number) {
  let used = 0, end = 0;
  for (const char of label) {
    const next = used + (/[\u3131-\uD79D]/.test(char) ? 13 : 7.5);
    if (next > room) return end >= 2 ? `${label.slice(0, end).trimEnd()}…` : "";
    used = next; end += char.length;
  }
  return label;
}

// A faded sample lane behind the empty state, so the graph isn't blank.
function previewDay(date: string): DayLog {
  const start = dayStart(date);
  const plan: [number, number, ActivityCategory, string][] = [
    [555, 600, "dev", "A프로젝트 결제 화면 수정"], [600, 630, "video", "유튜브 시청"], [630, 700, "docs", "분기 보고서 작성"],
    [780, 840, "meeting", "주간 기획 회의"], [840, 1010, "dev", "결제 API 버그 수정"],
  ];
  return {
    date, sessions: [], bookmarks: [],
    records: plan.map(([from, to, category, label]) => ({ startedAt: start + from * MINUTE, endedAt: start + to * MINUTE, category, label, app: "", side: [], thumbId: null })),
  };
}

function viewRange(day: DayLog, segments: DaySegment[], zoom: Zoom, focus: number | null) {
  const start = dayStart(day.date);
  const points = [...day.sessions.flatMap((session) => [session.startedAt, session.endedAt]), ...segments.flatMap((segment) => [segment.startedAt, segment.endedAt])];
  if (zoom === "day") {
    if (!points.length) return [start + 9 * HOUR, start + 18 * HOUR] as const;
    const from = Math.floor((Math.min(...points) - 10 * MINUTE - start) / HOUR) * HOUR + start;
    const to = Math.ceil((Math.max(...points) + 10 * MINUTE - start) / HOUR) * HOUR + start;
    return [Math.max(start, Math.min(from, to - 2 * HOUR)), Math.min(start + 24 * HOUR, Math.max(to, from + 2 * HOUR))] as const;
  }
  const span = zoom === "3h" ? 3 * HOUR : HOUR;
  const center = focus ?? (points.length ? Math.max(...points) : start + 12 * HOUR);
  const from = Math.min(Math.max(start, center - span / 2), start + 24 * HOUR - span);
  return [from, from + span] as const;
}

// `demo` renders the same screen from given data (the usage example):
// nothing is loaded or saved and the controls are inert.
export type TimelineDemo = { day: DayLog; thumbs: Record<string, string>; now: number; selected: number | null };

export function DayTimeline({ active, recorder, onStart, onStop, onShowExample, demo }: {
  active: boolean; recorder: RecorderStatus; onStart: () => void; onStop: () => void; onShowExample: () => void; demo?: TimelineDemo;
}) {
  const settings = useDayTimelineSettings();
  const [today, setToday] = useState(() => dateKey(Date.now()));
  const [date, setDate] = useState<string | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [storedDay, setDay] = useState<DayLog | null>(null);
  const [storedThumbs, setThumbs] = useState<Record<string, string>>({});
  const [usage, setUsage] = useState<number | null>(null);
  const [zoom, setZoom] = useState<Zoom>("day");
  const [picked, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [clockNow, setNow] = useState(() => Date.now());
  const day = demo?.day ?? storedDay;
  const thumbs = demo?.thumbs ?? storedThumbs;
  const now = demo?.now ?? clockNow;
  const selected = demo ? demo.selected : picked;
  const shownDate = demo?.day.date ?? date ?? today;

  const reload = useCallback(async () => {
    try {
      const [nextDay, nextThumbs, nextDates, nextUsage] = await Promise.all([loadDay(shownDate), loadThumbs(shownDate), listDates(), storageUsage()]);
      setDay(nextDay); setThumbs(nextThumbs); setDates(nextDates); setUsage(nextUsage);
    } catch { setDay(emptyDay(shownDate)); }
  }, [shownDate]);

  useEffect(() => {
    if (demo) return;
    const timer = window.setTimeout(() => void reload(), 0);
    const off = onDayLogChange(() => void reload());
    return () => { window.clearTimeout(timer); off(); };
  }, [demo, reload]);

  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()); setToday(dateKey(Date.now())); }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Optional: rewrite today's markdown into the saved folder every ten minutes.
  useEffect(() => {
    if (demo || !active || !settings.autoSave) return;
    const timer = window.setInterval(() => void (async () => {
      const directory = await savedExportDirectory();
      if (!directory || await directory.queryPermission({ mode: "readwrite" }) !== "granted") return;
      const current = await loadDay(dateKey(Date.now()));
      if (current.records.length) await saveToFolder(current, directory).catch(() => undefined);
    })(), AUTOSAVE_MS);
    return () => window.clearInterval(timer);
  }, [active, demo, settings.autoSave]);

  const realSegments = useMemo(() => day ? segmentsOf(day) : [], [day]);
  const empty = !realSegments.length;
  const ghostDay = useMemo(() => previewDay(shownDate), [shownDate]);
  const ghost = empty && !demo;
  const segments = useMemo(() => ghost ? segmentsOf(ghostDay) : realSegments, [ghost, ghostDay, realSegments]);
  const shownDay = ghost ? ghostDay : day;
  const totals = useMemo(() => categoryTotals(realSegments), [realSegments]);
  const worked = totals.reduce((sum, total) => sum + total.ms, 0);
  const segment = segments.find((item) => item.startedAt === selected) ?? null;
  const [from, to] = shownDay ? viewRange(shownDay, segments, zoom, segment ? (segment.startedAt + segment.endedAt) / 2 : null) : [0, 1];
  const x = (at: number) => L + ((Math.min(to, Math.max(from, at)) - from) / (to - from)) * (R - L);
  const span = to - from;
  const tick = span > 6 * HOUR ? HOUR : span > 2 * HOUR ? 30 * MINUTE : 10 * MINUTE;

  const run = async (work: () => Promise<string>) => {
    setBusy(true); setNotice("");
    try { setNotice(await work()); } catch (reason) { setNotice(reason instanceof Error ? reason.message : "처리하지 못했습니다."); } finally { setBusy(false); }
  };
  const change = async (next: DayLog, removed: string[] = []) => {
    await saveDay(next); await deleteThumbs(removed); notifyDayLog();
  };
  const downloadMarkdown = () => run(async () => {
    if (!day) return "";
    const url = URL.createObjectURL(new Blob([dayMarkdown(day, (id) => thumbs[id] ?? null)], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url; link.download = `Timeline-${day.date}.md`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return "MD 파일을 내려받았어요.";
  });
  const saveFolder = () => run(async () => {
    if (!day) return "";
    const directory = await chooseExportDirectory(await savedExportDirectory());
    await saveToFolder(day, directory);
    return `…/${directory.name}/Timeline-${day.date}/timeline.md 에 저장했어요.`;
  });

  const top = totals[0];
  const stats = [
    { label: "활동 시간", value: durationLabel(worked) },
    { label: "가장 많이 한 일", value: top ? `${CATEGORY_NAMES[top.category]} ${durationLabel(top.ms)}` : "-" },
    { label: "활동", value: `${realSegments.length}개` },
    { label: "북마크", value: `${day?.bookmarks.length ?? 0}개` },
  ];
  const weekday = new Date(dayStart(shownDate)).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" });
  const isToday = shownDate === dateKey(now);

  return <section className={styles.timeline} id={demo ? undefined : "timeline"} data-demo={Boolean(demo)} aria-labelledby={demo ? undefined : "timeline-title"} aria-label={demo ? "타임라인 사용 예시 화면" : undefined}>
    <header className={styles.head}>
      <div>
        <p className={styles.eyebrow}>TODAY TIMELINE</p>
        <h2 id={demo ? undefined : "timeline-title"}>{isToday ? "오늘 뭐 했지?" : `${shownDate.slice(5).replace("-", "/")} 뭐 했지?`}<span>{weekday}</span></h2>
      </div>
      <div className={styles.headControls}>
        {active
          ? <button type="button" className={styles.recording} onClick={onStop}><Record size={13} weight="fill" />타임라인 기록 중<span><Stop size={10} weight="fill" />끄기</span></button>
          : <button type="button" className={styles.start} onClick={onStart}><Record size={13} weight="fill" />타임라인 켜기</button>}
        <button type="button" className={styles.exampleButton} onClick={onShowExample}><Play size={12} weight="fill" />사용 예시</button>
        <label className={styles.select} title="이 간격마다 그동안의 화면 장면을 모아 '주로 한 일'과 '중간에 한 일'로 정리합니다."><Clock size={14} />기록 간격<select aria-label="기록 간격" value={settings.interval} onChange={(event) => settings.setInterval(Number(event.target.value))}>
          {RECORD_INTERVALS.map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes}분` : "1시간"}마다</option>)}
        </select></label>
        <label className={styles.select}><CalendarBlank size={14} /><select aria-label="날짜" value={shownDate} onChange={(event) => { setDate(event.target.value === today ? null : event.target.value); setSelected(null); }}>
          {[...new Set([today, ...dates])].map((item) => <option key={item} value={item}>{item === today ? `오늘 (${item})` : item}</option>)}
        </select></label>
        <div className={styles.zoom} role="group" aria-label="확대">
          {(["day", "3h", "1h"] as const).map((item) => <button key={item} type="button" aria-pressed={zoom === item} onClick={() => setZoom(item)}>{item === "day" ? "하루" : item === "3h" ? "3시간" : "1시간"}</button>)}
        </div>
      </div>
    </header>
    {active && isToday && <p className={styles.labeler} data-state={recorder.state}>
      {recorder.state === "working" ? <CircleNotch size={13} className={styles.spin} /> : recorder.state === "error" ? <WarningCircle size={13} weight="fill" /> : <Sparkle size={13} weight="fill" />}
      {recorder.state === "idle" && recorder.message ? `방금 정리: ${recorder.message}` : recorder.message || `화면 장면 ${recorder.held}개 모으는 중`}
      {recorder.nextAt && recorder.state !== "working" && <em>다음 정리 {clockLabel(recorder.nextAt)}</em>}
    </p>}

    <div className={styles.stats}>{stats.map((stat) => <p key={stat.label}><small>{stat.label}</small><b>{stat.value}</b></p>)}</div>

    {totals.length > 0 && <div className={styles.mix} aria-label="분류별 시간">
      <div className={styles.mixBar}>{totals.map((total) => <span key={total.category} style={{ flexGrow: total.ms, background: CATEGORY_COLORS[total.category] }} title={`${CATEGORY_NAMES[total.category]} ${durationLabel(total.ms)}`} />)}</div>
      <p>{totals.map((total) => <span key={total.category}><i style={{ background: CATEGORY_COLORS[total.category] }} />{CATEGORY_NAMES[total.category]} <b>{durationLabel(total.ms)}</b></span>)}</p>
    </div>}

    <div className={styles.graph} data-ghost={ghost} onMouseLeave={() => setHover(null)}><div className={styles.graphInner}>
      <svg viewBox={`0 0 ${W} 94`} role="img" aria-label={`${shownDate} 활동 타임라인`}>
        {Array.from({ length: Math.floor(span / tick) + 1 }, (_, index) => Math.ceil(from / tick) * tick + index * tick).filter((at) => at <= to).map((at) => <g key={at}>
          <line x1={x(at)} x2={x(at)} y1={LANE_TOP - 4} y2={LANE_TOP + LANE_H + 4} className={styles.grid} />
          <text x={x(at)} y={LANE_TOP + LANE_H + 22} className={styles.axis}>{clockLabel(at)}</text>
        </g>)}
        <rect x={L} y={LANE_TOP} width={R - L} height={LANE_H} rx={7} className={styles.off} />
        {day?.sessions.filter((session) => session.endedAt > from && session.startedAt < to).map((session) => <rect key={session.startedAt}
          x={x(session.startedAt)} y={LANE_TOP} width={Math.max(2, x(session.endedAt) - x(session.startedAt))} height={LANE_H} rx={7} className={styles.session} />)}
        {segments.filter((item) => item.endedAt > from && item.startedAt < to).map((item) => {
          const left = x(item.startedAt), width = Math.max(3, x(item.endedAt) - left - 1.5);
          const active = item === segment;
          const text = fitLabel(item.label, width - 20);
          return <g key={item.startedAt} className={styles.segment} data-active={active} data-fresh={Boolean(demo)} style={{ color: CATEGORY_COLORS[item.category] }} onClick={() => setSelected(active ? null : item.startedAt)}
            onMouseMove={() => setHover({ x: (left + width / 2) / W, text: `${clockLabel(item.startedAt)}–${clockLabel(item.endedAt)} · ${item.label}` })}>
            <rect x={left} y={LANE_TOP} width={width} height={LANE_H} rx={Math.min(7, width / 2)} />
            {text && <text x={left + 9} y={LANE_TOP + LANE_H / 2 + 4.5} className={styles.segmentText}>{text}</text>}
          </g>;
        })}
        {isToday && now > from && now < to && <g className={styles.now}><line x1={x(now)} x2={x(now)} y1={LANE_TOP - 6} y2={LANE_TOP + LANE_H + 6} /><circle cx={x(now)} cy={LANE_TOP - 6} r={3} /></g>}
        {day?.bookmarks.filter((bookmark) => bookmark.at >= from && bookmark.at <= to).map((bookmark) => <g key={bookmark.id} className={styles.pin}
          onMouseMove={() => setHover({ x: x(bookmark.at) / W, text: `${clockLabel(bookmark.at)} ${bookmark.note || "북마크"}` })}
          onClick={() => { const owner = segments.find((item) => bookmark.at >= item.startedAt && bookmark.at < item.endedAt); if (owner) setSelected(owner.startedAt); }}>
          <path d={`M${x(bookmark.at) - 5} 4h10v14l-5-4-5 4z`} />
        </g>)}
      </svg>
      </div>{hover && <span className={styles.tooltip} style={{ left: `${hover.x * 100}%` }}>{hover.text}</span>}
      {empty && <div className={styles.empty}>
        {active
          ? <b><CircleNotch size={14} className={styles.spin} />첫 정리 {recorder.nextAt ? clockLabel(recorder.nextAt) : "곧"}</b>
          : <button type="button" className={styles.start} onClick={onStart}><Record size={13} weight="fill" />타임라인 켜기</button>}
        {!demo && <button type="button" className={styles.exampleButton} onClick={onShowExample}><Play size={12} weight="fill" />사용 예시</button>}
      </div>}
    </div>

    {!empty && day && <ol className={styles.list}>
      {segments.map((item) => {
        const active = item === segment;
        return <li key={item.startedAt} data-active={active} style={{ "--cat": CATEGORY_COLORS[item.category] } as CSSProperties}>
          <button type="button" className={styles.row} aria-expanded={active} onClick={() => setSelected(active ? null : item.startedAt)}>
            <time>{clockLabel(item.startedAt)}</time>
            <i aria-hidden="true" />
            <span className={styles.rowMain}>
              <b>{item.label}</b>
              <small>{CATEGORY_NAMES[item.category]}{item.app && ` · ${item.app}`} · {clockLabel(item.startedAt)}–{clockLabel(item.endedAt)} · {durationLabel(item.endedAt - item.startedAt)}{item.bookmarks.length > 0 && <> · <BookmarkSimple size={11} weight="fill" /> {item.bookmarks.length}</>}</small>
              {item.side.length > 0 && <span className={styles.side}>중간에 · {sideLabel(item.side)}</span>}
            </span>
            {item.thumbIds[0] && thumbs[item.thumbIds[0]] && <img src={thumbs[item.thumbIds[0]]} alt="" />}
          </button>
          {active && <div className={styles.expand}>
            <label className={styles.rename}><PencilSimple size={13} /><input aria-label="활동 이름 고치기" defaultValue={item.label} maxLength={40}
              onBlur={(event) => { const label = event.target.value.trim(); if (label && label !== item.label) void change(renameSegment(day, item, label)); }}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>
            {item.thumbIds.some((id) => thumbs[id]) && <div className={styles.strip}>{item.thumbIds.filter((id) => thumbs[id]).map((id) => <img key={id} src={thumbs[id]} alt={`${item.label} 화면`} />)}</div>}
            {item.bookmarks.map((bookmark) => <div key={bookmark.id} className={styles.bookmark}>
              <BookmarkSimple size={13} weight="fill" /><time>{clockLabel(bookmark.at)}</time>
              <input aria-label={`${clockLabel(bookmark.at)} 북마크 이름`} defaultValue={bookmark.note} placeholder="북마크 이름 (예: 쿠폰 버그 재현됨)" maxLength={80}
                onBlur={(event) => { if (event.target.value !== bookmark.note) void change(renameBookmark(day, bookmark.id, event.target.value.trim())); }}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
              <button type="button" aria-label="북마크 삭제" onClick={() => void change(removeBookmark(day, bookmark.id), bookmark.thumbId ? [bookmark.thumbId] : [])}><Trash size={13} /></button>
            </div>)}
            <button type="button" className={styles.ghostDanger} onClick={() => { if (window.confirm(`${clockLabel(item.startedAt)}–${clockLabel(item.endedAt)} 기록을 지울까요?`)) { const result = removeRange(day, item.startedAt, item.endedAt); setSelected(null); void change(result.day, result.removedThumbs); } }}><Trash size={13} />이 활동 지우기</button>
          </div>}
        </li>;
      })}
    </ol>}

    <footer className={styles.actions}>
      <div>
        <button type="button" className={styles.primary} disabled={busy || empty} onClick={() => void downloadMarkdown()}>{busy ? <CircleNotch size={15} className={styles.spin} /> : <DownloadSimple size={15} />}MD로 저장</button>
        <button type="button" disabled={busy || empty} onClick={() => void saveFolder()}><FolderOpen size={15} />폴더에 저장</button>
        <label className={styles.check}><input type="checkbox" checked={settings.autoSave} onChange={(event) => settings.setAutoSave(event.target.checked)} />10분마다 폴더에 자동 저장</label>
        {notice && <span className={styles.notice}><Check size={13} />{notice}</span>}
      </div>
      <div>
        <span className={styles.privacy}><LockKey size={13} />이 브라우저에만 저장{usage !== null && ` · ${(usage / 1_048_576).toFixed(1)} MB`}</span>
        <label className={styles.select}>보관<select aria-label="보관 기간" value={settings.retention} onChange={(event) => settings.setRetention(Number(event.target.value))}>
          {RETENTION_DAYS.map((days) => <option key={days} value={days}>{days}일</option>)}
        </select></label>
        <button type="button" className={styles.ghostDanger} disabled={!day?.sessions.length} onClick={() => { if (window.confirm(`${shownDate} 기록을 모두 지울까요?`)) void deleteDay(shownDate).then(() => { setDate(null); notifyDayLog(); }); }}><Trash size={13} />이 날 지우기</button>
      </div>
    </footer>
  </section>;
}
