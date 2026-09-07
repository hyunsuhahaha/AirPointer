"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { InteractiveReplay, type RecordedScene } from "@/lib/interactive-replay";
import { drawWorkbench, workbenchLayout, type DevLog } from "@/lib/developer-workbench";
import styles from "./interactive-case.module.css";

type Filter = "all" | "draft";
type Phase = "idle" | "loading" | "error" | "draining" | "settled";
export function InteractiveCase({ onFreeze, onExit, external = false }: { onFreeze?: (replay: InteractiveReplay, question: string) => void; onExit: () => void; external?: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [guarded, setGuarded] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [logs, setLogs] = useState<DevLog[]>([{ time: "", text: "[browser] connected to development preview", level: "muted" }, { time: "", text: "[render] ready · choose a filter and refresh", level: "info" }]);
  const [file, setFile] = useState<"code" | "response">("code");
  const [responseText, setResponseText] = useState("// Refresh the preview to inspect its response.");
  const [posts, setPosts] = useState(["리플레이 UI 개선", "API 응답 타입 정리"]);
  const [compact, setCompact] = useState(false);
  const [question, setQuestion] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [focus, setFocus] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const history = useRef<RecordedScene[]>([]);
  const frozen = useRef(false);
  const recordedSize = useRef("");
  const { width, height, hits: layoutHits } = workbenchLayout(compact);
  const busy = phase === "loading" || phase === "error" || phase === "draining";
  useLayoutEffect(() => {
    // Hiding the landing sections changes document height. Reset after that commit,
    // before paint, rather than retaining the browser's old scroll anchor.
    window.scrollTo({ top: 0, behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const observer = new ResizeObserver(entries => setCompact(entries[0].contentRect.width < 650));
    if (viewport.current) observer.observe(viewport.current);
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed((Date.now() - started) / 1000), 250);
    return () => { observer.disconnect(); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    const log = (text: string, level: DevLog["level"] = "info") => setLogs(old => [...old, { text, level, time: new Date().toLocaleTimeString("en-GB", { hour12: false }) }].slice(-80));
    if (phase === "error") {
      const timer = window.setTimeout(() => setPhase("draining"), 650);
      return () => window.clearTimeout(timer);
    }
    if (phase === "draining") {
      let count = 0;
      // Real animation-frame callbacks produce ordinary verbose render diagnostics.
      // The console retains a bounded history and follows its newest entries.
      let animation = 0;
      const timer = window.setInterval(() => {
        animation = requestAnimationFrame(timestamp => {
          log(`[preview:debug] frame ${++count} · ${timestamp.toFixed(1)}ms · ${posts.length} rows`, "muted");
          if (count >= 9) { window.clearInterval(timer); setPhase("settled"); }
        });
      }, 95);
      return () => { window.clearInterval(timer); cancelAnimationFrame(animation); };
    }
    if (phase !== "loading") return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const path = `/api/developer-posts?status=${filter}`;
      const started = performance.now();
      try {
        const result = await fetch(path, { cache: "no-store" });
        if (!result.ok) throw new Error(`HTTP ${result.status} ${path}`);
        const response: { items?: string[] } = await result.json();
        const modulePath = "/developer-lab/PostList.js";
        const previewModule = await import(/* webpackIgnore: true */ modulePath) as { renderPosts: (response: { items?: string[] }, guarded: boolean) => string[] };
        if (cancelled) return;
        setResponseText(JSON.stringify(response, null, 2));
        log(`GET ${path} ${result.status} · ${(performance.now() - started).toFixed(0)}ms`);
        log(`[response] ${JSON.stringify(response)}`);
        const output = previewModule.renderPosts(response, guarded);
        setPosts(output); log(`[render] committed ${output.length} rows`); setPhase("draining");
      } catch (cause) {
        if (cancelled) return;
        setPosts([]);
        const stack = cause instanceof Error ? cause.stack || `${cause.name}: ${cause.message}` : String(cause);
        // Keep the native error and first real stack location. Only shorten origin.
        stack.split("\n").slice(0, 2).forEach(line => log(line.replaceAll(window.location.origin, ""), "error"));
        setPhase("error");
      }
    }, 500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [phase, filter, guarded, posts.length]);
  const hits = layoutHits.map(hit => ({ ...hit,
    pressed: hit.key === "all" ? filter === "all" : hit.key === "draft" ? filter === "draft" : hit.key === "guard" ? guarded : hit.key === "code" || hit.key === "response" ? file === hit.key : undefined,
    action: () => {
      if (hit.key === "code" || hit.key === "response") setFile(hit.key);
      else if (hit.key === "all" || hit.key === "draft") setFilter(hit.key);
      else if (hit.key === "guard") setGuarded(v => !v);
      else {
        const time = new Date().toLocaleTimeString("en-GB", { hour12: false });
        setLogs(old => [...old, { text: `[ui] filter = ${filter}; refresh requested`, time, level: "info" }, { text: `[render] guarded = ${guarded}`, time, level: "muted" }].slice(-80) as DevLog[]);
        setPhase("loading");
      }
    },
  }));
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx || !canvas.current) return;
    const focusBox = drawWorkbench(ctx, { compact, filter, guarded, phase, posts, logs, file, response: responseText });
    if (!frozen.current && !external) {
      if (recordedSize.current !== `${width}x${height}`) { history.current = []; recordedSize.current = `${width}x${height}`; }
      const now = Date.now();
      history.current.push({ url: canvas.current.toDataURL("image/jpeg", .9), at: now, focusBox });
      while (history.current.length > 1 && (history.current[1].at < now - 60_000 || history.current.length > 180)) history.current.shift();
    }
  }, [compact, filter, guarded, phase, posts, logs, file, responseText, external, width, height]);
  return <section className={styles.case} aria-label="직접 조작하는 개발 체험">
    <header className={styles.top}><div><span>CASE 01 / DEVELOPER WORKSPACE</span><h2 ref={heading} tabIndex={-1}>방금 로그, 뭐였지?</h2><p>게시글 필터를 바꾸고 새로고침하세요. 오류는 이어지는 로그에 밀려 사라집니다.</p></div><button onClick={onExit}>체험 나가기 ↗</button></header>
    <div className={styles.layout}><div className={styles.screenArea}>
      <div className={styles.browserBar}><span><i /><i /><i /></span><b>posts-web / development</b><small>LIVE JAVASCRIPT</small></div>
      <div ref={viewport} className={styles.canvasWrap}><canvas ref={canvas} width={width} height={height} aria-label={`개발 작업 화면 · ${filter} · ${phase}`} />{hits.map(hit => <button key={hit.key} className={styles.hit} aria-label={hit.label} aria-pressed={hit.pressed} disabled={busy} onClick={hit.action} onFocus={() => setFocus(hit.key)} onBlur={() => setFocus("")} data-focused={focus === hit.key} style={{ left: `${hit.x / width * 100}%`, top: `${hit.y / height * 100}%`, width: `${hit.w / width * 100}%`, height: `${hit.h / height * 100}%` }} />)}</div>
      <div className={styles.recording}><span><i />{external ? "DEVELOPER SANDBOX" : "LOCAL REPLAY"}</span><b>{Math.min(60, elapsed).toFixed(1)}s</b><small>{external ? "이 탭을 공유한 뒤 PiP에서 질문하세요" : "내가 조작한 화면을 기록 중"}</small></div>
    </div><aside className={styles.guide}><span className={styles.eyebrow}>YOUR MISSION</span><h3>작업은 계속하세요.<br />단서는 AI가 찾습니다.</h3><ol><li data-active={phase === "idle"}><b>01</b><div>임시저장 필터 선택<small>빈 응답 처리 전후를 비교할 수도 있어요.</small></div></li><li data-active={busy}><b>02</b><div>새로고침 실행<small>짧게 뜬 오류가 후속 로그에 밀립니다.</small></div></li><li data-active={phase === "settled"}><b>03</b><div>{external ? "PiP에서 리플레이 질문" : "놓친 순간 질문하기"}<small>행동과 오류, 이후 화면을 함께 확인합니다.</small></div></li></ol>
      <div className={styles.receipt} aria-live="polite"><small>작업 상태</small><strong>{filter === "all" ? "전체 게시글" : "임시저장"}</strong><span>{guarded ? "기본값 처리 적용" : "응답을 바로 목록으로 변환"}</span><b>{phase === "error" ? "오류 로그 발생" : phase === "settled" ? "후속 로그가 이어졌어요. 방금 무슨 일이었을까요?" : phase === "loading" ? "응답 처리 중" : "필터를 바꾸고 새로고침해 보세요."}</b></div>
      {external ? <p className={styles.footnote}>메인 화면에서 화면 공유를 시작하고 이 탭을 선택하세요. PiP의 ‘리플레이’에서 “방금 왜 목록이 비었지?”라고 질문하세요.</p> : <><label className={styles.question}>AI에게 물어보기<textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="방금 왜 목록이 비었지? 무슨 오류였어?" maxLength={500} /></label><button className={styles.find} disabled={phase !== "settled"} onClick={() => { frozen.current = true; onFreeze?.(new InteractiveReplay(history.current, Date.now(), width, height), question.trim() || "방금 왜 목록이 비었지? 직전에 한 작업과 놓친 로그를 함께 확인해줘."); }}>방금 오류 찾아줘 <span>↶</span></button><a href="/developer-lab" target="_blank" rel="noreferrer" className={styles.footnote}>같은 작업을 실제 화면 공유·PiP로 체험 ↗</a></>}
      <p className={styles.footnote}>체험용 API와 JavaScript 모듈을 실제로 실행합니다. 콘솔의 오류·스택은 실행 결과입니다.</p>
    </aside></div>
  </section>;
}
