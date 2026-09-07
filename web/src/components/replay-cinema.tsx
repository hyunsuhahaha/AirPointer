"use client";
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { EvidenceItem, ExplorationProgress } from "./browser-capture-panel";
import type { OverviewFrame } from "@/lib/replay-buffer";
import styles from "./replay-cinema.module.css";

type Phase = "searching" | "rewinding" | "locked" | "zooming" | "revealed" | "manual";
const labels: Record<Phase, string> = { searching: "화면을 되짚는 중", rewinding: "근거 시점으로 되감기", locked: "이 순간에 단서가 있습니다", zooming: "단서를 가까이", revealed: "근거와 답변이 연결됐습니다", manual: "직접 탐색 중" };

export function ReplayCinema({ frames, evidence, activeEvidence, sequence, exploration, onOpenEvidence }: {
  frames: OverviewFrame[]; evidence: EvidenceItem[]; activeEvidence: number; sequence: number; exploration?: ExplorationProgress; onOpenEvidence: (index: number) => void;
}) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("searching");
  const [playhead, setPlayhead] = useState(0);
  const [manualFrame, setManualFrame] = useState<OverviewFrame | null>(null);
  const [zoom, setZoom] = useState(false);
  const [aspect, setAspect] = useState(1200 / 760);
  const [rerun, setRerun] = useState(0);
  const manual = useRef(false);
  const cancel = useRef<() => void>(() => {});
  const strip = useRef<HTMLDivElement>(null);
  const target = evidence[activeEvidence] ?? evidence[0];
  const ordered = [...frames].sort((a, b) => b.atSeconds - a.atSeconds);
  const maxTime = Math.max(1, ...frames.map(f => f.atSeconds), target?.frame.atSeconds ?? 0);

  const priorSequence = useRef(sequence);
  useEffect(() => {
    if (priorSequence.current !== sequence) { priorSequence.current = sequence; manual.current = false; }
    if (manual.current) return;
    if (!target) {
      const pending = requestAnimationFrame(() => { setPhase("searching"); setZoom(false); setManualFrame(null); });
      return () => cancelAnimationFrame(pending);
    }
    let alive = true;
    let raf = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stop = () => { alive = false; cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
    cancel.current = stop;
    let started = 0;
    const tick = (now: number) => {
      if (!alive) return;
      const progress = Math.min(1, (now - started) / 1350);
      setPlayhead(target.frame.atSeconds * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) raf = requestAnimationFrame(tick);
      else {
        setPhase("locked");
        timers.push(setTimeout(() => { if (alive) { setPhase("zooming"); setZoom(true); } }, 420));
        timers.push(setTimeout(() => { if (alive) setPhase("revealed"); }, 1350));
      }
    };
    raf = requestAnimationFrame(() => {
      if (!alive) return;
      setManualFrame(null); setZoom(false);
      if (reduced) { setPlayhead(target.frame.atSeconds); setPhase("revealed"); setZoom(true); return; }
      setPhase("rewinding"); setPlayhead(0); started = performance.now();
      raf = requestAnimationFrame(tick);
    });
    return stop;
  }, [target, sequence, rerun, reduced]);

  const nearest = (seconds: number) => ordered.filter(f => f.kind !== "queried-crop").reduce<OverviewFrame | undefined>((best, frame) => !best || Math.abs(frame.atSeconds - seconds) < Math.abs(best.atSeconds - seconds) ? frame : best, undefined);
  const evidenceBase = target?.frame.kind === "queried-crop" ? frames.find(f => f.kind !== "queried-crop" && Math.abs(f.atSeconds - target.frame.atSeconds) < .04) ?? target.frame : target?.frame;
  const current = manualFrame ?? (target ? phase === "rewinding" ? nearest(playhead) ?? evidenceBase : evidenceBase : frames.at(-1));
  const box = target && current === evidenceBase && phase !== "rewinding" && phase !== "manual" && (evidenceBase?.kind !== "queried-crop") ? target.focusBox ?? target.frame.focusBox : undefined;
  const scale = zoom && box ? Math.max(1, Math.min(3.2, .88 / Math.max(box[2] - box[0], box[3] - box[1]))) : 1;
  const cx = box ? (box[0] + box[2]) / 2 : .5;
  const cy = box ? (box[1] + box[3]) / 2 : .5;
  const transform = `translate(${(.5 - cx) * 100 * scale}%, ${(.5 - cy) * 100 * scale}%) scale(${scale})`;
  const marker = 100 * (1 - (phase === "manual" ? current?.atSeconds ?? 0 : target ? playhead : current?.atSeconds ?? 0) / maxTime);

  const takeControl = (frame: OverviewFrame) => {
    manual.current = true; cancel.current(); setZoom(false); setPhase("manual"); setManualFrame(frame); setPlayhead(frame.atSeconds);
  };
  const follow = () => { manual.current = false; setManualFrame(null); setRerun(v => v + 1); };
  // An explicit evidence click resumes the authored sequence, even after scrubbing.
  useEffect(() => {
    if (phase === "manual") return;
    const selected = strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (selected && strip.current) strip.current.scrollTo({ left: selected.offsetLeft - strip.current.offsetLeft - strip.current.clientWidth / 2 + selected.clientWidth / 2, behavior: reduced ? "instant" : "smooth" });
  }, [current, phase, reduced]);

  return <div className={styles.cinema} data-phase={phase} aria-label="시간 되감기 뷰어">
    <header className={styles.header}><div><span>REPLAY / {target ? "EVIDENCE FOUND" : "EXPLORING"}</span><h3 role="status">{labels[phase]}</h3></div><div className={styles.clock}><b>−{(current?.atSeconds ?? 0).toFixed(2)}</b><span>SECONDS AGO</span></div></header>
    <div className={styles.monitor} style={{ aspectRatio: aspect }}>
      {current ? <div className={styles.imagePlane} style={{ transform }}><img src={current.url} alt="선택한 과거 화면" onLoad={e => setAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />{box && <span className={styles.focusBox} style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }} />}</div> : <div className={styles.empty}>실제로 확인한 장면이 여기에 나타납니다.</div>}
      {phase === "rewinding" && <span className={styles.rewindBadge}>↶ REWIND</span>}
      {box && phase !== "rewinding" && <span className={styles.focusBadge}>{zoom ? `DETAIL ×${scale.toFixed(1)}` : "MOMENT LOCATED"}</span>}
      {(phase === "locked" || phase === "zooming" || phase === "revealed") && <span className={styles.frameCorners} aria-hidden="true" />}
    </div>
    <div className={styles.transport}><span>{phase === "manual" ? "MANUAL" : target ? "EVIDENCE PLAYBACK" : "LIVE SEARCH"}</span><div>{target && <><button onClick={follow} aria-label="근거 발견 장면 다시 보기">↶ 다시 보기</button><button disabled={!target.focusBox && !target.frame.focusBox} onClick={() => { cancel.current(); manual.current = true; setPhase("revealed"); setManualFrame(evidenceBase ?? null); setPlayhead(target.frame.atSeconds); setZoom(z => !z); }}>{zoom ? "전체 화면" : "단서 확대"}</button><button onClick={() => onOpenEvidence(activeEvidence)}>전후 원본 보기 ↗</button></>}</div></div>
    <div className={styles.timeline}>
      <div className={styles.ticks}>{Array.from({ length: 6 }, (_, i) => <span key={i}>−{(maxTime * (1 - i / 5)).toFixed(1)}s</span>)}</div>
      <div className={styles.rail}><span className={styles.playhead} style={{ left: `${Math.max(0, Math.min(100, marker))}%` }} /><input type="range" min={0} max={maxTime} step={.01} value={Math.max(0, maxTime - (current?.atSeconds ?? 0))} aria-label="리플레이 시간 직접 탐색" onChange={e => { const frame = nearest(maxTime - Number(e.target.value)); if (frame) takeControl(frame); }} /></div>
      <div ref={strip} className={styles.strip}>{ordered.map((frame, i) => <button key={`${frame.kind}-${frame.atSeconds}-${i}`} aria-pressed={current?.url === frame.url && current?.atSeconds === frame.atSeconds} onClick={() => takeControl(frame)}><img src={frame.url} alt={`${i + 1}번째 확인 프레임`} /><span>{frame.kind === "queried-crop" ? "ZOOM " : ""}−{frame.atSeconds.toFixed(2)}s</span></button>)}</div>
    </div>
    {target && phase !== "rewinding" && phase !== "manual" && <div className={styles.linked} data-revealed={phase === "revealed"}><b>↳ EVIDENCE {String(activeEvidence + 1).padStart(2, "0")}</b><p>{target.claim}</p></div>}
    {exploration && <div className={styles.exploration}><span><i data-active={exploration.active} />{exploration.active ? "AI 탐색 중" : "탐색 완료"}</span><b>{exploration.usedFrames}<small> / {exploration.frameBudget} FRAMES</small></b><details><summary>탐색 기록{exploration.timing ? ` · ${(exploration.timing.totalMs / 1000).toFixed(1)}초` : ""}</summary><ol>{exploration.steps.map((step, i) => <li key={i}>{step.label}<small>{step.detail}</small></li>)}</ol></details></div>}
  </div>;
}
