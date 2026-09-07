"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, ArrowUp, Camera, CaretDown, CircleNotch, CornersIn, CornersOut, FrameCorners, LockSimple, Plus } from "@phosphor-icons/react";
import styles from "./browser-capture-panel.module.css";
import { cropRegion } from "@/lib/replay-buffer";
import type { ChangeHighlight } from "@/lib/replay-buffer";

import type { CaptureSnapshot } from "@/lib/analysis-payload";

export type AnalysisMode = "current" | "replay" | "text";
export type ConversationTurn = { role: "user" | "assistant"; text: string };
export type Analyze = (mode: AnalysisMode, question?: string, history?: ConversationTurn[], image?: CaptureSnapshot) => Promise<{ text: string; captureContext?: string } | { error: string }>;
export function RegionCapture({ image, busy, onSend, onCancel }: {
  image: CaptureSnapshot; busy: boolean; onSend: (image: CaptureSnapshot, question: string) => Promise<void>; onCancel: () => void;
}) {
  const [box, setBox] = useState<[number, number, number, number]>([0.25, 0.25, 0.75, 0.75]);
  const anchor = useRef<[number, number] | null>(null);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const locked = busy || preparing;
  const position = (event: React.PointerEvent<HTMLDivElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };
  return <section aria-label="캡처 영역 선택" className={styles.region}>
    <div className={styles.regionHeading}><strong>영역 선택</strong><span>드래그로 영역 선택</span></div>
    <div tabIndex={0} role="group" aria-label="선택 영역: 방향키로 이동, Shift와 방향키로 크기 조절" className={styles.regionCanvas}
      onPointerDown={(event) => { if (locked || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); anchor.current = position(event); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={(event) => { if (!anchor.current || locked) return; const [x, y] = position(event); const [ax, ay] = anchor.current; setBox([Math.min(x, ax), Math.min(y, ay), Math.max(x, ax), Math.max(y, ay)]); }}
      onPointerUp={() => { anchor.current = null; }} onPointerCancel={() => { anchor.current = null; }}
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
      <span className={styles.selection} style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }} />
    </div>
    <p className={styles.regionHint}>방향키로 이동 · Shift + 방향키로 크기 조절</p>
    <input aria-label="선택 영역에 대한 질문" placeholder="질문 (선택)" value={question} maxLength={500} disabled={locked} onChange={(event) => setQuestion(event.target.value)} className={styles.regionInput} />
    <div className={styles.regionActions}>
      <button className={styles.regionSubmit} disabled={locked || box[2] - box[0] < 0.01 || box[3] - box[1] < 0.01} onClick={async () => {
        setPreparing(true); setError("");
        try { await onSend({ ...image, url: await cropRegion(image.url, box, 0), selection: box }, question); }
        catch { setError("영역을 준비하지 못했습니다. 다시 선택해 주세요."); }
        finally { setPreparing(false); }
      }}>{locked ? <CircleNotch className={styles.spinner} size={15} /> : <FrameCorners size={15} />}{locked ? "처리 중…" : "선택 영역 분석"}</button>
      <button className={styles.secondary} disabled={locked} onClick={onCancel}>취소</button>
    </div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}

type DisplayTurn = ConversationTurn & { source?: string; captureContext?: string };

export function BrowserCapturePanel({ active, busy, elapsed, retention, seconds, highlight, snapshot, analyze }: {
  active: boolean; busy: boolean; elapsed: number; retention: number; seconds: number;
  highlight: ChangeHighlight | null; snapshot: () => CaptureSnapshot; analyze: Analyze;
}) {
  const [history, setHistory] = useState<DisplayTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [region, setRegion] = useState<CaptureSnapshot | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<DisplayTurn | null>(null);
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const locked = busy || pending !== null;
  const resize = (open: boolean) => {
    setExpanded(open);
    try { panel.current?.ownerDocument.defaultView?.resizeTo(open ? 380 : 320, open ? 560 : 120); } catch { /* The browser owns PiP window placement. */ }
  };
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [history, pending]);
  const send = async (mode: AnalysisMode, image?: CaptureSnapshot, regionQuestion?: string) => {
    if (inFlight.current || busy) return;
    const prompt = regionQuestion ?? question.trim();
    if (mode === "text" && (!prompt || !history.length)) return;
    resize(true);
    inFlight.current = true; setError("");
    const source = image ? "선택 영역" : mode === "current" ? "현재 화면" : mode === "replay" ? `최근 ${seconds}초 리플레이` : undefined;
    const turn: DisplayTurn = { role: "user", text: prompt || `${source} 분석`, source: prompt ? source : undefined };
    setPending(turn);
    try {
      const result = await analyze(mode, prompt || undefined, history.map(({ role, text }) => ({ role, text })), image);
      if ("text" in result) {
        setHistory((previous) => [...previous, { ...turn, captureContext: result.captureContext }, { role: "assistant", text: result.text } as DisplayTurn].slice(-8));
        setQuestion(""); setRegion(null);
      } else setError(result.error);
    } catch {
      setError("답변을 가져오지 못했어요. 잠시 후 다시 보내주세요.");
    } finally {
      inFlight.current = false; setPending(null);
    }
  };
  const captureRegion = () => {
    try { setRegion(snapshot()); setError(""); resize(true); }
    catch { setError("화면을 준비하지 못했어요. 화면 공유 상태를 확인해 주세요."); }
  };
  const turns = pending ? [...history, pending] : history;
  return <main ref={panel} className={styles.panel} data-expanded={expanded}>
    <header className={styles.header}>
      <span className={styles.recordingLabel} title={`로컬 버퍼 ${Math.floor(elapsed / 1000)}초 / ${retention}분`}><span className={styles.dot} data-active={active} />{active ? "기록 중" : "공유 꺼짐"}</span>
      <div className={styles.headerActions}>
        {expanded && <button className={styles.iconButton} aria-label="새 대화" title="새 대화" disabled={locked || !history.length} onClick={() => { setHistory([]); setQuestion(""); setRegion(null); setError(""); }}><Plus size={17} /></button>}
        <button className={styles.iconButton} disabled={locked} aria-label={expanded ? "버튼만 남기기" : "대화 펼치기"} title={expanded ? "작게 접기" : "대화 펼치기"} onClick={() => { setRegion(null); resize(!expanded); }}>{expanded ? <CornersIn size={17} /> : <CornersOut size={17} />}</button>
      </div>
    </header>
    <div className={styles.actions} aria-label="화면 캡처">
      <button className={styles.replay} disabled={!active || locked} aria-label="최근 리플레이" title={`최근 ${seconds}초 분석`} onClick={() => void send("replay")}><span className={styles.replayLabel}><ArrowCounterClockwise size={17} weight="bold" />리플레이</span></button>
      <button className={styles.secondary} disabled={!active || locked} onClick={() => void send("current")}><Camera size={15} />화면</button>
      <button className={styles.secondary} disabled={!active || locked} onClick={captureRegion}><FrameCorners size={15} />영역</button>
    </div>
    {expanded && <>
      <div className={styles.scroll}>
        {active && highlight && !region && <details className={styles.highlight}>
          <summary><span><FrameCorners size={13} />변화 전후</span><CaretDown size={12} /></summary>
          <div className={styles.comparison}>
            <figure><div className={styles.comparisonImage}><img src={highlight.beforeUrl} alt="변화 이전" /></div><figcaption>이전</figcaption></figure>
            <figure><div className={styles.comparisonImage}><img src={highlight.afterUrl} alt="변화 이후" /><span className={styles.changeBox} style={{ left: `${highlight.bbox[0] * 100}%`, top: `${highlight.bbox[1] * 100}%`, width: `${(highlight.bbox[2] - highlight.bbox[0]) * 100}%`, height: `${(highlight.bbox[3] - highlight.bbox[1]) * 100}%` }} /></div><figcaption>이후 · 변화 영역</figcaption></figure>
          </div>
        </details>}
        {region && active ? <RegionCapture image={region} busy={locked} onCancel={() => setRegion(null)} onSend={(image, prompt) => send("current", image, prompt)} /> : <>
          {!turns.length && !locked && <div className={styles.empty}><p>{active ? "화면을 선택하면 분석 결과가 표시됩니다." : "메인 탭에서 화면 공유를 시작하세요."}</p></div>}
          <div className={styles.conversation} role="log" aria-label="AI 대화" aria-live="polite" aria-busy={locked}>
            {turns.map((turn, index) => <article key={index} className={`${styles.turn} ${turn.role === "user" ? styles.userTurn : styles.answer}`} aria-label={turn.role === "user" ? "내 질문" : "AI 답변"}>
              {turn.source && <div className={styles.source}><FrameCorners size={11} />{turn.source}</div>}
              <p>{turn.text}</p>
              {turn.captureContext && <details className={styles.receipt}><summary>전송 정보</summary><pre>{turn.captureContext}</pre></details>}
            </article>)}
            {locked && <div className={styles.thinking} role="status"><CircleNotch className={styles.spinner} size={15} />분석 중</div>}
            <div ref={end} />
          </div>
        </>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </div>
      {!region && <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send("text"); }}>
        <div className={styles.inputBox}>
          <textarea aria-label="AI에게 질문" placeholder={history.length ? "후속 질문" : "질문 (선택)"} maxLength={500} value={question} disabled={locked} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && question.trim() && history.length) { event.preventDefault(); void send("text"); } }} />
          <button className={styles.send} disabled={locked || !question.trim() || !history.length} type="submit" aria-label="질문만 보내기 · 화면 첨부 없음" title="질문만 보내기"><ArrowUp size={17} weight="bold" /></button>
        </div>
        <div className={styles.composerHint}><span className={styles.privacy}><LockSimple size={10} />{history.length ? "텍스트만 전송" : "화면 선택 후 분석"}</span><span>Shift ↵ 줄바꿈</span></div>
      </form>}
    </>}
  </main>;
}
