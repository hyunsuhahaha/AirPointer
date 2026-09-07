"use client";
/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { cropRegion } from "@/lib/replay-buffer";
import type { ChangeHighlight } from "@/lib/replay-buffer";

export type AnalysisMode = "current" | "replay" | "text";
export type ConversationTurn = { role: "user" | "assistant"; text: string };
export type Analyze = (mode: AnalysisMode, question?: string, history?: ConversationTurn[], image?: string) => Promise<{ text: string } | { error: string }>;
const button: CSSProperties = { padding: "9px 12px", border: "1px solid #555", borderRadius: 8, background: "#181a18", color: "#f3f3ed", font: "inherit", cursor: "pointer" };
const row: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };

export function RegionCapture({ image, busy, onSend, onCancel }: {
  image: string; busy: boolean; onSend: (image: string, question: string) => Promise<void>; onCancel: () => void;
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
  return <section aria-label="캡처 영역 선택" style={{ display: "grid", gap: 10 }}>
    <p style={{ margin: 0 }}>고정한 화면에서 분석할 영역을 드래그하세요.</p>
    <div tabIndex={0} role="group" aria-label="선택 영역: 방향키로 이동, Shift와 방향키로 크기 조절" style={{ position: "relative", touchAction: "none", cursor: "crosshair", lineHeight: 0 }}
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
      <img src={image} alt="분석 전 고정한 공유 화면" draggable={false} style={{ width: "100%", display: "block" }} />
      <span style={{ position: "absolute", pointerEvents: "none", border: "2px solid #ff5c22", boxSizing: "border-box", background: "#ff5c2220", left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }} />
    </div>
    <small>방향키: 이동 · Shift + 방향키: 크기 조절</small>
    <input aria-label="선택 영역에 대한 질문" placeholder="이 부분에서 무엇이 궁금한가요?" value={question} maxLength={500} disabled={locked} onChange={(event) => setQuestion(event.target.value)} style={{ ...button, minWidth: 0 }} />
    <div style={row}>
      <button style={button} disabled={locked || box[2] - box[0] < 0.01 || box[3] - box[1] < 0.01} onClick={async () => {
        setPreparing(true); setError("");
        try { await onSend(await cropRegion(image, box, 0), question); }
        catch { setError("영역을 준비하지 못했습니다. 다시 선택해 주세요."); }
        finally { setPreparing(false); }
      }}>{locked ? "처리 중…" : "선택 영역 분석"}</button>
      <button style={button} disabled={locked} onClick={onCancel}>취소</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function BrowserCapturePanel({ active, busy, elapsed, retention, seconds, highlight, snapshot, analyze }: {
  active: boolean; busy: boolean; elapsed: number; retention: number; seconds: number;
  highlight: ChangeHighlight | null; snapshot: () => string; analyze: Analyze;
}) {
  const [history, setHistory] = useState<ConversationTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [region, setRegion] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const inFlight = useRef(false);
  const end = useRef<HTMLDivElement>(null);
  const locked = busy || sending;
  const resize = (open: boolean) => {
    setExpanded(open);
    try { panel.current?.ownerDocument.defaultView?.resizeTo(380, open ? 620 : 240); } catch { /* Browser may keep its own PiP size. */ }
  };
  const send = async (mode: AnalysisMode, image?: string, regionQuestion?: string) => {
    if (inFlight.current || busy) return;
    const prompt = regionQuestion ?? question.trim();
    if (mode === "text" && !prompt) return;
    resize(true);
    inFlight.current = true; setSending(true); setError("");
    const userText = prompt || (image ? "선택 영역" : mode === "current" ? "지금 화면" : `최근 ${seconds}초`);
    const result = await analyze(mode, prompt || undefined, history, image);
    if ("text" in result) {
      setHistory((previous) => [...previous, { role: "user", text: userText }, { role: "assistant", text: result.text }].slice(-8) as ConversationTurn[]);
      setQuestion(""); setRegion("");
    } else setError(result.error);
    inFlight.current = false; setSending(false);
    requestAnimationFrame(() => end.current?.scrollIntoView({ block: "end" }));
  };
  return <main ref={panel} style={{ background: "#101110", color: "#f3f3ed", font: "13px/1.5 system-ui, sans-serif", padding: 12, display: "grid", gap: 12 }}>
    <header><strong>방금그거뭐였지</strong><div role="status" style={{ color: active ? "#ff925f" : "#9ba198" }}>{active ? `기록 중 · ${Math.floor(elapsed / 1000)}초 / ${retention}분 · 최근 ${seconds}초 분석` : "화면 공유 꺼짐 · 메인 탭에서 시작하세요"}</div></header>
    {active && highlight && <details>
      <summary>방금 바뀐 화면 · 이전 / 이후</summary>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
        <img src={highlight.beforeUrl} alt="변화 이전" style={{ width: "100%" }} />
        <div style={{ position: "relative", lineHeight: 0 }}><img src={highlight.afterUrl} alt="변화 이후" style={{ width: "100%" }} /><span style={{ position: "absolute", border: "2px solid #ff5c22", boxSizing: "border-box", left: `${highlight.bbox[0] * 100}%`, top: `${highlight.bbox[1] * 100}%`, width: `${(highlight.bbox[2] - highlight.bbox[0]) * 100}%`, height: `${(highlight.bbox[3] - highlight.bbox[1]) * 100}%` }} /></div>
      </div>
    </details>}
    <div style={row}>
      <button style={button} disabled={!active || locked} onClick={() => void send("current")}>지금 화면</button>
      <button style={button} disabled={!active || locked} onClick={() => void send("replay")}>최근 리플레이</button>
      <button style={button} disabled={!active || locked} onClick={() => { try { setRegion(snapshot()); resize(true); } catch { setError("화면을 준비하지 못했습니다."); } }}>영역 선택</button>
    </div>
    {region && active && <RegionCapture image={region} busy={locked} onCancel={() => setRegion("")} onSend={(image, prompt) => send("current", image, prompt)} />}
    {expanded && <div role="log" aria-label="AI 대화" aria-live="polite" style={{ display: "grid", gap: 8 }}>
      {history.map((turn, index) => <p key={index} style={{ margin: 0, padding: 10, background: turn.role === "user" ? "#30251e" : "#181a18", borderRadius: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><strong>{turn.role === "user" ? "나" : "AI"}</strong><br />{turn.text}</p>)}
      {locked && <p role="status">분석 중…</p>}
      <div ref={end} />
    </div>}
    {error && <p role="alert" style={{ color: "#ffad86", margin: 0 }}>{error}</p>}
    {expanded && <form onSubmit={(event) => { event.preventDefault(); void send("text"); }} style={{ display: "grid", gap: 8 }}>
      <textarea aria-label="AI에게 질문" placeholder="이어서 물어보기…" maxLength={500} value={question} disabled={locked} onChange={(event) => setQuestion(event.target.value)} style={{ ...button, resize: "vertical", minHeight: 50 }} />
      <button style={button} disabled={locked || !question.trim() || !history.length} type="submit">질문만 보내기 · 화면 첨부 없음</button>
      <small style={{ color: "#9ba198" }}>이전 대화는 텍스트로만 기억합니다. 화면을 다시 보여주려면 위 캡처 버튼을 누르세요.</small>
      <button style={button} disabled={locked || !history.length} type="button" onClick={() => { setHistory([]); setQuestion(""); setError(""); }}>새 대화</button>
    </form>}
    <button style={button} disabled={locked} onClick={() => { setRegion(""); resize(!expanded); }}>{expanded ? "버튼만 남기기" : "대화 펼치기"}</button>
  </main>;
}
