"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowCounterClockwise, FastForward, FileText, Pause, Play, X } from "@phosphor-icons/react";
import { dateKey, dayMarkdown, dayStart } from "@/lib/day-log";
import * as script from "@/lib/usage-example-daylog";
import type { ThumbKind } from "@/lib/usage-example-daylog";
import { DayTimeline } from "./day-timeline";
import styles from "./day-timeline-demo.module.css";

// The timeline usage example: the real timeline screen, fed a scripted day.

const THUMB_STYLE: Record<ThumbKind, [string, string[]]> = {
  code: ["#1e1b3a", ["#7f77dd", "#e59a6d", "#7fb3f5", "#8fd18b"]],
  bug: ["#0d1117", ["#8b949e", "#f85149", "#7ee787", "#8b949e"]],
  review: ["#0d1117", ["#2ea043", "#30363d", "#f85149", "#30363d"]],
  docs: ["#ffffff", ["#3c4043", "#dadce0", "#dadce0", "#dadce0"]],
  video: ["#0f0f0f", ["#ff0033", "#3f3f46", "#3f3f46", "#3f3f46"]],
  meeting: ["#10251d", ["#a78bfa", "#5b9dff", "#2fc58f", "#f06bc4"]],
};

function thumbUrl(kind: ThumbKind) {
  const [background, colors] = THUMB_STYLE[kind];
  const bars = Array.from({ length: 9 }, (_, index) => `<rect x="${24 + (index % 3) * 14}" y="${36 + index * 26}" width="${150 + ((index * 53) % 200)}" height="10" rx="3" fill="${colors[index % colors.length]}"/>`).join("");
  const body = kind === "video" ? `<rect x="40" y="30" width="400" height="220" rx="12" fill="#1d3b5c"/><rect x="206" y="116" width="68" height="48" rx="12" fill="#ff0033"/>`
    : kind === "meeting" ? colors.map((color, index) => `<rect x="${16 + (index % 2) * 228}" y="${16 + Math.floor(index / 2) * 138}" width="220" height="130" rx="10" fill="${color}" opacity=".8"/>`).join("")
    : bars;
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 300"><rect width="480" height="300" fill="${background}"/>${body}</svg>`)}`;
}

// The saved Markdown as a document preview: the overview and the category
// table, with table rows turned into plain cells.
function previewLines(markdown: string) {
  const lines = markdown.split("\n");
  const end = lines.findIndex((line) => line.startsWith("## 상세 타임라인"));
  return lines.slice(0, end < 0 ? undefined : end)
    .filter((line) => line && !line.startsWith("|---") && !line.startsWith("| 분류 |"))
    .map((line) => line.startsWith("|") ? line.split("|").map((cell) => cell.trim()).filter(Boolean).join("   ") : line);
}

const THUMBS = Object.fromEntries((Object.keys(THUMB_STYLE) as ThumbKind[]).map((kind) => [script.thumbId(kind), thumbUrl(kind)]));

export function DayTimelineDemo({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const clock = useRef(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 1, shift: 0 });
  const [date] = useState(() => dateKey(Date.now()));
  const start = dayStart(date);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const next = Math.min(script.DURATION, clock.current + Math.min(0.1, (now - last) / 1_000));
      last = now;
      clock.current = next;
      setT(next);
      if (next >= script.DURATION) { setPlaying(false); return; }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  // Fit the screen's width; when rows push it past the window, follow the bottom.
  useLayoutEffect(() => {
    const node = content.current, frame = stage.current;
    if (!node || !frame) return;
    const update = () => {
      const scale = Math.min(1, (frame.clientWidth - 48) / node.offsetWidth, (frame.clientHeight - 40) / 640);
      setFit({ scale, shift: Math.max(0, node.offsetHeight * scale - (frame.clientHeight - 110)) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node); observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const day = useMemo(() => script.dayAt(t, date, start), [date, start, t]);
  const now = start + script.clockAt(t) * 60_000;
  const md = script.mdAt(t);
  const markdown = useMemo(() => md.visible ? previewLines(dayMarkdown(day, () => null)) : [], [day, md.visible]);
  const caption = script.captionAt(t);
  const restart = () => { clock.current = 0; setT(0); setPlaying(true); };
  const toggle = () => { if (clock.current >= script.DURATION) restart(); else setPlaying((value) => !value); };

  return createPortal(
    <div ref={dialog} className={styles.overlay} role="dialog" aria-modal="true" aria-label="타임라인 사용 예시" tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        else if (event.key === " ") toggle();
        else return;
        event.preventDefault();
      }}>
      <header className={styles.bar}>
        <b>타임라인 사용 예시</b>
        {script.fastForward(t) && <span className={styles.fast}><FastForward size={13} weight="fill" />오후까지 빨리 감기</span>}
        <div>
          <button type="button" onClick={toggle} aria-label={playing ? "일시정지" : "재생"}>{playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}</button>
          <button type="button" onClick={restart} aria-label="처음부터"><ArrowCounterClockwise size={16} /></button>
          <button type="button" onClick={onClose} aria-label="예시 닫기"><X size={16} weight="bold" /></button>
        </div>
      </header>
      <div ref={stage} className={styles.stage}>
        <div ref={content} className={styles.screen} style={{ transform: `translate(-50%, ${-fit.shift}px) scale(${fit.scale})` }}>
          <DayTimeline active recorder={script.statusAt(t, start)} onStart={() => undefined} onStop={() => undefined} onShowExample={() => undefined}
            demo={{ day, thumbs: THUMBS, now, selected: script.selectedAt(t, start) }} />
        </div>
        {md.visible && <article className={styles.md}>
            <header><FileText size={16} weight="fill" />Timeline-{date}.md</header>
            <div>{markdown.slice(0, Math.max(1, Math.ceil(md.progress * markdown.length))).map((line, index) => {
              const kind = line.startsWith("# ") ? "h1" : line.startsWith("## ") ? "h2" : line.startsWith("  -") ? "sub" : line.startsWith("- ") ? "item" : /%$/.test(line) ? "table" : "text";
              return <p key={index} data-kind={kind}>{line.replace(/^#+ /, "").replace(/^ *- /, "").replace(/\*\*/g, "")}</p>;
            })}</div>
          </article>}
      </div>
      {caption && <p key={caption.text} className={styles.caption}>{caption.text}</p>}
      <div className={styles.progress} aria-hidden="true"><span style={{ width: `${(t / script.DURATION) * 100}%` }} /></div>
    </div>,
    document.body,
  );
}
