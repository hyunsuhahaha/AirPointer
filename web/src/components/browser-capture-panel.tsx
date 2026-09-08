"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowUp, BookmarkSimple, Camera, CaretDown, Check, CircleNotch, CornersIn, CornersOut, FrameCorners, LockSimple, Pause, Play, Plus, ShieldCheck, X } from "@phosphor-icons/react";
import styles from "./browser-capture-panel.module.css";
import { cropRegion } from "@/lib/replay-buffer";
import type { ChangeHighlight, NormalizedBox, OverviewFrame } from "@/lib/replay-buffer";
import type { PrivacyReport } from "@/lib/privacy-redaction";

import { ANALYSIS_MODELS } from "@/lib/analysis-payload";
import type { AnalysisModelId, CaptureSnapshot } from "@/lib/analysis-payload";

export type AnalysisMode = "current" | "replay" | "text";
export type ConversationTurn = { role: "user" | "assistant"; text: string };
export type EvidenceItem = { claim: string; frame: OverviewFrame; timeline?: OverviewFrame[]; focusBox?: NormalizedBox };
export type AnalysisTiming = { totalMs: number; captureMs: number; privacyMs: number; apiMs: number; replayMs: number; evidenceMs: number };
export type ExplorationProgress = { active: boolean; usedFrames: number; frameBudget: number; round: number; maxRounds: number; steps: { label: string; detail: string; added: number; status?: "working" | "done" }[]; timing?: AnalysisTiming };
export type Analyze = (mode: AnalysisMode, question?: string, history?: ConversationTurn[], image?: CaptureSnapshot, model?: AnalysisModelId) => Promise<{ text: string; captureContext?: string; evidence?: EvidenceItem[]; exploration?: ExplorationProgress; privacy?: PrivacyReport } | { error: string }>;
export function RegionCapture({ image, busy, fullScreenByDefault = false, onSend, onCancel }: {
  image: CaptureSnapshot; busy: boolean; fullScreenByDefault?: boolean; onSend: (image: CaptureSnapshot, question: string) => Promise<void>; onCancel: () => void;
}) {
  const [box, setBox] = useState<[number, number, number, number]>(fullScreenByDefault ? [0, 0, 1, 1] : [0.25, 0.25, 0.75, 0.75]);
  const drag = useRef<
    | { mode: "draw"; anchor: [number, number] }
    | { mode: "move"; anchor: [number, number]; box: [number, number, number, number] }
    | null
  >(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const locked = busy || preparing;
  const fullScreen = box[0] === 0 && box[1] === 0 && box[2] === 1 && box[3] === 1;
  const position = (event: React.PointerEvent<HTMLDivElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };
  return <section aria-label={fullScreenByDefault ? "분석할 화면 선택" : "캡처 영역 선택"} className={styles.region}>
    <div className={styles.regionHeading}><strong>{fullScreenByDefault ? "화면 선택" : "영역 선택"}</strong><span>{fullScreen ? "전체 화면 선택됨" : "드래그로 영역 선택"}</span></div>
    <div tabIndex={0} role="group" aria-label="선택 영역: 경계선을 드래그하거나 방향키로 이동, Shift와 방향키로 크기 조절" className={styles.regionCanvas}
      onPointerDown={(event) => {
        if (locked || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        const point = position(event);
        drag.current = (event.target as HTMLElement).dataset.selectionMove === "true"
          ? { mode: "move", anchor: point, box }
          : { mode: "draw", anchor: point };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current || locked) return;
        const [x, y] = position(event);
        if (drag.current.mode === "draw") {
          const [ax, ay] = drag.current.anchor;
          setBox([Math.min(x, ax), Math.min(y, ay), Math.max(x, ax), Math.max(y, ay)]);
          return;
        }
        const { anchor: [ax, ay], box: [left, top, right, bottom] } = drag.current;
        const width = right - left;
        const height = bottom - top;
        const nextLeft = Math.max(0, Math.min(1 - width, left + x - ax));
        const nextTop = Math.max(0, Math.min(1 - height, top + y - ay));
        setBox([nextLeft, nextTop, nextLeft + width, nextTop + height]);
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !locked) { onCancel(); return; }
        if (!event.key.startsWith("Arrow") || locked) return;
        event.preventDefault();
        const dx = event.key === "ArrowLeft" ? -0.02 : event.key === "ArrowRight" ? 0.02 : 0;
        const dy = event.key === "ArrowUp" ? -0.02 : event.key === "ArrowDown" ? 0.02 : 0;
        setBox(([l, t, r, b]) => event.shiftKey
          ? [l, t, Math.max(l + 0.02, Math.min(1, r + dx)), Math.max(t + 0.02, Math.min(1, b + dy))]
          : (() => { const x = Math.max(-l, Math.min(1 - r, dx)); const y = Math.max(-t, Math.min(1 - b, dy)); return [l + x, t + y, r + x, b + y]; })());
      }}>
      <img src={image.url} alt="분석 전 고정한 공유 화면" draggable={false} />
      <span className={styles.selection} style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }}>
        <i aria-hidden="true" data-selection-move="true" className={`${styles.selectionMoveEdge} ${styles.selectionMoveTop}`} />
        <i aria-hidden="true" data-selection-move="true" className={`${styles.selectionMoveEdge} ${styles.selectionMoveRight}`} />
        <i aria-hidden="true" data-selection-move="true" className={`${styles.selectionMoveEdge} ${styles.selectionMoveBottom}`} />
        <i aria-hidden="true" data-selection-move="true" className={`${styles.selectionMoveEdge} ${styles.selectionMoveLeft}`} />
      </span>
    </div>
    <p className={styles.regionHint}>{fullScreenByDefault ? "전체 화면이 기본 선택됩니다 · 드래그로 새 영역 선택 · 방향키로 이동" : "경계선을 드래그해 이동 · 방향키로 이동 · Shift + 방향키로 크기 조절"}</p>
    <input aria-label="선택 화면에 대한 질문" aria-required="true" placeholder="무엇을 확인할까요?" value={question} maxLength={500} disabled={locked} onChange={(event) => setQuestion(event.target.value)} className={styles.regionInput} />
    <div className={styles.regionActions}>
      <button className={styles.regionSubmit} disabled={locked || !question.trim() || box[2] - box[0] < 0.01 || box[3] - box[1] < 0.01} onClick={async () => {
        setPreparing(true); setError("");
        try { await onSend(fullScreen ? image : { ...image, url: await cropRegion(image.url, box, 0), selection: box }, question); }
        catch { setError("영역을 준비하지 못했습니다. 다시 선택해 주세요."); }
        finally { setPreparing(false); }
      }}>{locked ? <CircleNotch className={styles.spinner} size={15} /> : fullScreen ? <Camera size={15} /> : <FrameCorners size={15} />}{locked ? "처리 중…" : fullScreen ? "전체 화면 분석" : "선택 영역 분석"}</button>
      <button className={styles.secondary} disabled={locked} onClick={onCancel}>취소</button>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}

export function PrivacyZoneEditor({ image, value, onSave, onCancel }: { image: CaptureSnapshot; value?: NormalizedBox; onSave: (box: NormalizedBox) => void; onCancel: () => void }) {
  const [box, setBox] = useState<NormalizedBox>(value ?? [0.15, 0.72, 0.85, 0.9]);
  const anchor = useRef<[number, number] | null>(null);
  const position = (event: React.PointerEvent<HTMLDivElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };
  return <section className={styles.region} aria-label="개인정보 가림 영역 지정">
    <div className={styles.regionHeading}><strong>항상 가릴 영역</strong><span>드래그로 지정</span></div>
    <div className={styles.regionCanvas} tabIndex={0} role="group" aria-label="가림 영역을 드래그하거나 방향키로 이동"
      onPointerDown={(event) => { if (event.button !== 0) return; anchor.current = position(event); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (!anchor.current) return; const point = position(event); setBox([Math.min(anchor.current[0], point[0]), Math.min(anchor.current[1], point[1]), Math.max(anchor.current[0], point[0]), Math.max(anchor.current[1], point[1])]); }}
      onPointerUp={() => { anchor.current = null; }} onPointerCancel={() => { anchor.current = null; }}
      onKeyDown={(event) => { if (!event.key.startsWith("Arrow")) return; event.preventDefault(); const dx = event.key === "ArrowLeft" ? -0.01 : event.key === "ArrowRight" ? 0.01 : 0; const dy = event.key === "ArrowUp" ? -0.01 : event.key === "ArrowDown" ? 0.01 : 0; setBox(([left, top, right, bottom]) => { const x = Math.max(-left, Math.min(1 - right, dx)); const y = Math.max(-top, Math.min(1 - bottom, dy)); return [left + x, top + y, right + x, bottom + y]; }); }}>
      <img src={image.url} alt="가림 영역을 지정할 현재 화면" draggable={false} />
      <span className={`${styles.selection} ${styles.privacySelection}`} style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }}><b>PRIVATE</b></span>
    </div>
    <p className={styles.regionHint}>이 영역은 모든 전송 프레임에서 브라우저가 먼저 가립니다. 원본은 로컬 버퍼에만 남습니다.</p>
    <div className={styles.regionActions}><button type="button" className={styles.regionSubmit} disabled={box[2] - box[0] < 0.01 || box[3] - box[1] < 0.01} onClick={() => onSave(box)}><ShieldCheck size={15} />가림 영역 저장</button><button type="button" className={styles.secondary} onClick={onCancel}>취소</button></div>
  </section>;
}

export function EvidenceTimeMachine({ evidence, onClose }: { evidence: EvidenceItem; onClose: () => void }) {
  const timeline = evidence.timeline?.length ? evidence.timeline : [evidence.frame];
  const center = timeline.reduce((best, frame, index) => Math.abs(frame.atSeconds - evidence.frame.atSeconds) < Math.abs(timeline[best].atSeconds - evidence.frame.atSeconds) ? index : best, 0);
  const [index, setIndex] = useState(center);
  const [playing, setPlaying] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ownerWindow = dialog.current?.ownerDocument.defaultView;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    ownerWindow?.addEventListener("keydown", closeOnEscape);
    return () => ownerWindow?.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setIndex((current) => {
      if (current >= timeline.length - 1) { setPlaying(false); return current; }
      return current + 1;
    }), 300);
    return () => window.clearInterval(timer);
  }, [playing, timeline.length]);
  const frame = timeline[index];
  const focusBox = evidence.focusBox ?? frame.focusBox;
  return <div ref={dialog} className={styles.timeMachineBackdrop} role="dialog" aria-modal="true" aria-label="근거 타임머신" onClick={onClose}>
    <section className={styles.timeMachine} onClick={(event) => event.stopPropagation()}>
      <header><div><strong>근거 타임머신</strong><span>전후 2초 · 로컬 원본</span></div><button type="button" autoFocus aria-label="근거 타임머신 닫기" onClick={onClose}><X size={18} /></button></header>
      <div className={styles.timeMachineFrame}><img src={frame.url} alt={`${frame.atSeconds.toFixed(2)}초 전 근거 화면`} />{focusBox && <span style={{ left: `${focusBox[0] * 100}%`, top: `${focusBox[1] * 100}%`, width: `${(focusBox[2] - focusBox[0]) * 100}%`, height: `${(focusBox[3] - focusBox[1]) * 100}%` }} />}<b>-{frame.atSeconds.toFixed(2)}s</b></div>
      <div className={styles.timeMachineReason}><small>AI가 이 순간을 고른 이유</small><p>{evidence.claim}</p></div>
      <div className={styles.timeMachineControls}><button type="button" aria-label={playing ? "재생 일시정지" : "전후 프레임 재생"} onClick={() => { if (index >= timeline.length - 1) setIndex(0); setPlaying((value) => !value); }}>{playing ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}</button><input type="range" aria-label="근거 전후 시간 탐색" min={0} max={timeline.length - 1} step={1} value={index} onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)); }} /><span>{index + 1}/{timeline.length}</span></div>
      <div className={styles.timeMachineStrip}>{timeline.map((item, itemIndex) => <button type="button" key={`${item.capturedAt}-${itemIndex}`} aria-label={`${item.atSeconds.toFixed(2)}초 전 화면`} aria-current={itemIndex === index} onClick={() => { setPlaying(false); setIndex(itemIndex); }}><img src={item.url} alt="" /><span>-{item.atSeconds.toFixed(1)}s</span></button>)}</div>
    </section>
  </div>;
}

type DisplayTurn = ConversationTurn & { source?: string; captureContext?: string; evidence?: EvidenceItem[]; exploration?: ExplorationProgress };

export function BrowserCapturePanel({ active, busy, elapsed, retention, seconds, onSecondsChange, bookmarkCount, bookmarkEnabled, onBookmark, frames, highlight, exploration, snapshot, analyze, initialExpanded = false, demoMode = "idle", demoQuestion = "", demoAnswer = "", demoEvidence = [], demoCaptureContext = "", privacyEnabled, onPrivacyEnabledChange, privacyZone, onPrivacyZoneChange, privacyReport }: {
  active: boolean; busy: boolean; elapsed: number; retention: number; seconds: number;
  onSecondsChange: (seconds: number) => void;
  bookmarkCount: number; bookmarkEnabled: boolean; onBookmark: () => void;
  frames: OverviewFrame[]; highlight: ChangeHighlight | null; exploration?: ExplorationProgress; snapshot: () => CaptureSnapshot; analyze: Analyze;
  initialExpanded?: boolean; demoMode?: "idle" | "playing" | "ready"; demoQuestion?: string; demoAnswer?: string; demoEvidence?: EvidenceItem[]; demoCaptureContext?: string;
  privacyEnabled: boolean; onPrivacyEnabledChange: (enabled: boolean) => void; privacyZone?: NormalizedBox; onPrivacyZoneChange: (box?: NormalizedBox) => void; privacyReport?: PrivacyReport;
}) {
  const [history, setHistory] = useState<DisplayTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [region, setRegion] = useState<CaptureSnapshot | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<DisplayTurn | null>(null);
  const [expanded, setExpanded] = useState(initialExpanded);
  const [captureMode, setCaptureMode] = useState<"replay" | null>(demoMode === "ready" ? "replay" : null);
  const [model, setModel] = useState<AnalysisModelId>(() => {
    const saved = typeof window === "undefined" ? null : window.localStorage.getItem("airpointer-analysis-model");
    return ANALYSIS_MODELS.some((option) => option.id === saved) ? saved as AnalysisModelId : "gpt-5.4-mini";
  });
  const [previewImage, setPreviewImage] = useState<{ url: string; alt: string } | null>(null);
  const [timelineEvidence, setTimelineEvidence] = useState<EvidenceItem | null>(null);
  const [privacyImage, setPrivacyImage] = useState<CaptureSnapshot | null>(null);
  const panel = useRef<HTMLElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const locked = busy || pending !== null;
  const resize = (open: boolean) => {
    setExpanded(open);
    try { panel.current?.ownerDocument.defaultView?.resizeTo(open ? 380 : 320, open ? 560 : 120); } catch { /* The browser owns PiP window placement. */ }
  };
  const selectReplay = () => {
    setCaptureMode((selected) => selected === "replay" ? null : "replay");
    setRegion(null); setError(""); resize(true);
    panel.current?.ownerDocument.defaultView?.requestAnimationFrame(() => composer.current?.focus());
  };
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [history, pending]);
  useEffect(() => {
    if (!previewImage) return;
    const ownerWindow = panel.current?.ownerDocument.defaultView;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPreviewImage(null); };
    ownerWindow?.addEventListener("keydown", closeOnEscape);
    return () => ownerWindow?.removeEventListener("keydown", closeOnEscape);
  }, [previewImage]);
  const send = async (mode: AnalysisMode, image?: CaptureSnapshot, regionQuestion?: string) => {
    if (inFlight.current || busy) return;
    const prompt = regionQuestion ?? question.trim();
    if (!prompt || (mode === "text" && !history.length)) return;
    resize(true);
    inFlight.current = true; setError("");
    const source = image?.selection ? "선택 영역" : mode === "current" ? "현재 화면" : mode === "replay" ? `최근 ${seconds}초 리플레이` : undefined;
    const turn: DisplayTurn = { role: "user", text: prompt, source };
    setPending(turn);
    try {
      const result = await analyze(mode, prompt || undefined, history.map(({ role, text }) => ({ role, text })), image, model);
      if ("text" in result) {
        setHistory((previous) => [...previous, { ...turn, captureContext: result.captureContext }, { role: "assistant", text: result.text, evidence: result.evidence, exploration: result.exploration } as DisplayTurn].slice(-8));
        setQuestion(""); setRegion(null); setCaptureMode(null);
      } else setError(result.error);
    } catch {
      setError("답변을 가져오지 못했어요. 잠시 후 다시 보내주세요.");
    } finally {
      inFlight.current = false; setPending(null);
    }
  };
  const captureScreen = () => {
    try { setCaptureMode(null); setRegion(snapshot()); setError(""); resize(true); }
    catch { setError("화면을 준비하지 못했어요. 화면 공유 상태를 확인해 주세요."); }
  };
  const demoTurns: DisplayTurn[] = demoMode !== "idle" && demoQuestion && !history.length ? [
    { role: "user", text: demoQuestion, source: `오류 감지 후 자동 질문 · 최근 ${seconds}초 리플레이` },
    ...(demoAnswer ? [{ role: "assistant" as const, text: demoAnswer, evidence: demoEvidence, exploration, captureContext: demoCaptureContext }] : []),
  ] : [];
  const turns = pending ? [...history, pending] : history.length ? history : demoTurns;
  return <main ref={panel} className={styles.panel} data-expanded={expanded}>
    <header className={styles.header}>
      <div className={styles.headerContext}>
        <span className={styles.recordingLabel} title={`로컬 버퍼 ${Math.floor(elapsed / 1000)}초 / ${retention}분`}><span className={styles.dot} data-active={active} />{active ? "기록 중" : "공유 꺼짐"}</span>
        <label className={styles.modelPicker}>
          <span className={styles.srOnly}>분석 모델</span>
          <select value={model} disabled={locked} onChange={(event) => {
            const next = event.target.value as AnalysisModelId;
            setModel(next); window.localStorage.setItem("airpointer-analysis-model", next);
          }}>
            {ANALYSIS_MODELS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <CaretDown size={10} aria-hidden="true" />
        </label>
        <label className={`${styles.modelPicker} ${styles.timePicker}`}>
          <span className={styles.srOnly}>리플레이 구간</span>
          <select value={seconds} disabled={locked} onChange={(event) => onSecondsChange(Number(event.target.value))}>
            <option value={5}>5초</option>
            <option value={15}>15초</option>
            <option value={30}>30초</option>
            <option value={60}>1분</option>
          </select>
          <CaretDown size={10} aria-hidden="true" />
        </label>
      </div>
      <div className={styles.headerActions}>
        {expanded && <button className={styles.iconButton} aria-label="새 대화" title="새 대화" disabled={locked || !history.length} onClick={() => { setHistory([]); setQuestion(""); setRegion(null); setPrivacyImage(null); setCaptureMode(null); setPreviewImage(null); setTimelineEvidence(null); setError(""); }}><Plus size={17} /></button>}
        <button className={styles.iconButton} aria-label={expanded ? "버튼만 남기기" : "대화 펼치기"} title={expanded ? "작게 접기" : "대화 펼치기"} onClick={() => { setRegion(null); resize(!expanded); }}>{expanded ? <CornersIn size={17} /> : <CornersOut size={17} />}</button>
      </div>
    </header>
    <div className={styles.actions} aria-label="화면 캡처">
      <button className={styles.replay} disabled={!active || locked} aria-label="최근 리플레이 첨부" aria-pressed={captureMode === "replay"} title={`최근 ${seconds}초 첨부`} onClick={selectReplay}><span className={styles.replayLabel}><ArrowCounterClockwise size={17} weight="bold" />리플레이</span></button>
      <button className={styles.secondary} disabled={!active || locked} aria-label="현재 화면 선택" onClick={captureScreen}><Camera size={15} />화면</button>
      <button className={`${styles.secondary} ${styles.bookmarkAction}`} disabled={!bookmarkEnabled} aria-label={`현재 시점 북마크${bookmarkCount ? ` · ${bookmarkCount}개 저장됨` : ""}`} title="현재 화면을 별도 저장해 다음 리플레이에 추가" onClick={onBookmark}><BookmarkSimple size={15} weight={bookmarkCount ? "fill" : "regular"} />북마크{bookmarkCount ? <span>{bookmarkCount}</span> : null}</button>
    </div>
    {expanded && <>
      <div className={styles.privacyBar} data-enabled={privacyEnabled}>
        <label><input type="checkbox" checked={privacyEnabled} disabled={locked} onChange={(event) => onPrivacyEnabledChange(event.target.checked)} /><ShieldCheck size={14} weight="fill" /><span>전송 전 개인정보 자동 가림</span></label>
        <button type="button" disabled={!active || locked} onClick={() => { try { setPrivacyImage(snapshot()); setRegion(null); } catch { setError("가림 영역을 지정할 화면이 없습니다."); } }}>{privacyZone ? "영역 변경" : "영역 지정"}</button>
        {privacyZone && <button type="button" disabled={locked} aria-label="사용자 지정 가림 영역 삭제" onClick={() => onPrivacyZoneChange(undefined)}>해제</button>}
      </div>
      <div className={styles.scroll}>
        {privacyReport?.preview && !region && !privacyImage && <details className={styles.privacyReceipt}><summary><span><ShieldCheck size={13} />{privacyReport.maskedRegions ? `${privacyReport.maskedRegions}곳 가림 완료` : "민감정보 검사 완료"}</span><small>{privacyReport.scannedFrames}장 로컬 검사</small></summary><div><button type="button" onClick={() => setPreviewImage({ url: privacyReport.preview!.beforeUrl, alt: "가리기 전 로컬 원본" })}><img src={privacyReport.preview.beforeUrl} alt="가리기 전 로컬 원본" /><span>로컬 원본</span></button><button type="button" onClick={() => setPreviewImage({ url: privacyReport.preview!.afterUrl, alt: "실제 전송된 가림 화면" })}><img src={privacyReport.preview.afterUrl} alt="실제 전송된 가림 화면" /><span>실제 전송</span></button></div></details>}
        {active && highlight && !region && <details className={styles.highlight}>
          <summary><span><FrameCorners size={13} />변화 전후</span><CaretDown size={12} /></summary>
          <div className={styles.comparison}>
            <figure><button type="button" className={styles.comparisonImage} aria-label="변화 이전 화면 크게 보기" onClick={() => setPreviewImage({ url: highlight.beforeUrl, alt: "변화 이전 화면 확대" })}><img src={highlight.beforeUrl} alt="변화 이전" /></button><figcaption>이전</figcaption></figure>
            <figure><button type="button" className={styles.comparisonImage} aria-label="변화 이후 화면 크게 보기" onClick={() => setPreviewImage({ url: highlight.afterUrl, alt: "변화 이후 화면 확대" })}><img src={highlight.afterUrl} alt="변화 이후" /><span className={styles.changeBox} style={{ left: `${highlight.bbox[0] * 100}%`, top: `${highlight.bbox[1] * 100}%`, width: `${(highlight.bbox[2] - highlight.bbox[0]) * 100}%`, height: `${(highlight.bbox[3] - highlight.bbox[1]) * 100}%` }} /></button><figcaption>이후 · 변화 영역</figcaption></figure>
          </div>
        </details>}
        {frames.length > 0 && !region && <details className={styles.sentFrames} aria-label="최근 전송 화면">
          <summary className={styles.sentFramesHeader}><strong>최근 전송 화면</strong><span>{exploration ? `${frames.length}/${exploration.frameBudget}장` : `${frames.length}장`}<CaretDown size={12} /></span></summary>
          <div className={styles.sentFramesGrid}>
            {frames.map((frame, index) => <button type="button" key={`${frame.atSeconds}-${index}`} aria-label={`${index + 1}번째 전송 화면 크게 보기`}
              onClick={() => setPreviewImage({ url: frame.url, alt: `${index + 1}번째 전송 화면 확대` })}>
              <img src={frame.url} alt={`${index + 1}번째 전송 화면`} />
              <span data-query={frame.kind !== "replay-frame"}>{frame.kind === "queried-crop" ? "확대 " : frame.kind === "queried-frame" ? "추가 " : frame.kind === "bookmarked-frame" ? "북마크 " : ""}{frame.atSeconds > 0.005 ? `-${frame.atSeconds.toFixed(2)}s` : "현재"}</span>
            </button>)}
          </div>
        </details>}
        {exploration?.active && !region && <ExplorationMeter value={exploration} />}
        {privacyImage ? <PrivacyZoneEditor image={privacyImage} value={privacyZone} onCancel={() => setPrivacyImage(null)} onSave={(box) => { onPrivacyZoneChange(box); setPrivacyImage(null); }} /> : region && active ? <RegionCapture image={region} busy={locked} fullScreenByDefault onCancel={() => setRegion(null)} onSend={(image, prompt) => send("current", image, prompt)} /> : <>
          {!turns.length && demoMode === "playing" && <div className={`${styles.empty} ${styles.demoEmpty}`} role="status"><CircleNotch className={styles.spinner} size={20} /><strong>실행 결과 녹화 재생 중</strong><p>재생이 끝나면 화면 기록만으로 원인을 탐색합니다.</p></div>}
          {!turns.length && !locked && demoMode !== "playing" && <div className={styles.empty}><p>{active ? "화면을 선택하면 분석 결과가 표시됩니다." : "메인 탭에서 화면 공유를 시작하세요."}</p></div>}
          <div className={styles.conversation} role="log" aria-label="AI 대화" aria-live="polite" aria-busy={locked}>
            {turns.map((turn, index) => <article key={index} className={`${styles.turn} ${turn.role === "user" ? styles.userTurn : styles.answer}`} aria-label={turn.role === "user" ? "내 질문" : "AI 답변"}>
              {turn.source && <div className={styles.source}><FrameCorners size={11} />{turn.source}</div>}
              <p>{turn.text}</p>
              {turn.exploration && !turn.exploration.active ? <ExplorationMeter value={turn.exploration} /> : null}
              {turn.evidence?.length ? <section className={styles.evidence} aria-label="답변 화면 근거">
                <div className={styles.evidenceHeading}><strong>화면 근거</strong><span>{turn.evidence.length}개</span></div>
                <ol>{turn.evidence.map(({ claim, frame }, evidenceIndex) => <li key={`${index}-${evidenceIndex}`}>
                    <button type="button" className={styles.evidenceButton} aria-label={`${claim} 근거 타임머신 열기`} onClick={() => setTimelineEvidence(turn.evidence![evidenceIndex])}>
                      <img src={frame.url} alt="답변을 뒷받침하는 화면" />
                      <span className={styles.evidenceText}><small>{frame.kind === "queried-frame" ? "추가 조회 · " : ""}{frame.atSeconds > 0.005 ? `-${frame.atSeconds.toFixed(2)}초` : "현재"}</small><b>{claim}</b></span>
                    </button>
                  </li>)}</ol>
              </section> : null}
              {turn.captureContext && <details className={styles.receipt}><summary>전송 정보</summary><pre>{turn.captureContext}</pre></details>}
            </article>)}
            {locked && <div className={styles.thinking} role="status"><CircleNotch className={styles.spinner} size={15} />분석 중</div>}
            <div ref={end} />
          </div>
        </>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </div>
      {!region && !privacyImage && <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(captureMode ?? "text"); }}>
        <div className={styles.inputBox}>
          <textarea ref={composer} aria-label="AI에게 질문" placeholder={captureMode === "replay" ? `최근 ${seconds}초에서 무엇을 확인할까요?` : history.length ? "후속 질문" : "먼저 화면을 선택하세요"} maxLength={500} value={question} disabled={locked} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && question.trim() && (captureMode || history.length)) { event.preventDefault(); void send(captureMode ?? "text"); } }} />
          <button className={styles.send} disabled={locked || !question.trim() || (!captureMode && !history.length)} type="submit" aria-label={captureMode ? `최근 ${seconds}초 리플레이와 질문 보내기` : "질문만 보내기 · 화면 첨부 없음"} title="보내기"><ArrowUp size={17} weight="bold" /></button>
        </div>
        <div className={styles.composerHint}><span className={styles.privacy}><LockSimple size={10} />{captureMode === "replay" ? `최근 ${seconds}초 리플레이 선택됨` : history.length ? "텍스트만 전송" : "화면 선택 후 질문 입력"}</span><span>Shift ↵ 줄바꿈</span></div>
      </form>}
    </>}
    {previewImage && <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label="화면 크게 보기" onClick={() => setPreviewImage(null)}>
      <button type="button" autoFocus aria-label="확대 화면 닫기" onClick={() => setPreviewImage(null)}><X size={18} /></button>
      <img src={previewImage.url} alt={previewImage.alt} onClick={(event) => event.stopPropagation()} />
      <span>ESC로 닫기</span>
    </div>}
    {timelineEvidence && <EvidenceTimeMachine evidence={timelineEvidence} onClose={() => setTimelineEvidence(null)} />}
  </main>;
}

function ExplorationMeter({ value }: { value: ExplorationProgress }) {
  const percent = Math.min(100, (value.usedFrames / value.frameBudget) * 100);
  return <section className={styles.exploration} aria-label="적응형 프레임 탐색 현황" aria-live="polite">
    <div className={styles.explorationHead}><strong>{value.active ? <><CircleNotch className={styles.spinner} size={12} />AI 탐색 실시간</> : <><Check size={12} weight="bold" />탐색 완료</>}</strong><span>{value.usedFrames}/{value.frameBudget} frames · {value.round}/{value.maxRounds} rounds</span></div>
    <div className={styles.explorationBar} role="progressbar" aria-label="프레임 조회 예산" aria-valuemin={0} aria-valuemax={value.frameBudget} aria-valuenow={value.usedFrames}><span style={{ transform: `scaleX(${percent / 100})` }} /></div>
    {value.timing && <div className={styles.timingReceipt} aria-label="분석 성능 측정">
      <strong>총 {(value.timing.totalMs / 1000).toFixed(1)}초</strong>
      <span>캡처 {(value.timing.captureMs / 1000).toFixed(1)}s</span>
      <span>가림 {(value.timing.privacyMs / 1000).toFixed(1)}s</span>
      <span>AI {(value.timing.apiMs / 1000).toFixed(1)}s</span>
      <span>재탐색 {(value.timing.replayMs / 1000).toFixed(1)}s</span>
      <span>근거 {(value.timing.evidenceMs / 1000).toFixed(1)}s</span>
    </div>}
    <ol>{value.steps.map((step, index) => { const working = value.active && step.status === "working"; return <li key={`${step.label}-${index}`} data-status={working ? "working" : "done"}><span>{working ? <CircleNotch className={styles.spinner} size={11} /> : <Check size={11} weight="bold" />}</span><p><b>{step.label}</b><small>{step.detail}</small></p><em>{working ? "LIVE" : step.added ? `+${step.added}` : "완료"}</em></li>; })}</ol>
  </section>;
}
