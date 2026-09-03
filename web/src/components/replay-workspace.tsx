"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowClockwise, ArrowCounterClockwise, Camera, Check, CircleNotch, Desktop, HandPalm, LockKey, PaperPlaneTilt, Play, Stop, WarningCircle, X } from "@phosphor-icons/react";
import { useCompanionGesture } from "@/hooks/use-companion-gesture";
import { BrowserReplayBuffer, frameFromVideo } from "@/lib/replay-buffer";
import type { ReplayCapsule } from "@/lib/replay-buffer";
import styles from "./replay-workspace.module.css";

type Status = "idle" | "recording" | "preparing" | "analyzing" | "done" | "error";
type Mode = "current" | "replay";
type AgentState = "loading" | "idle" | "preparing" | "drafting" | "sending" | "queued" | "done" | "error";
type AgentThread = { id: string; title: string; status: string; cwd: string; updatedAt: number };
type PendingAgentCapture =
  | { mode: "current"; threadId: string; seconds: number; frames: string[]; region?: boolean }
  | { mode: "replay"; threadId: string; seconds: number; capsule: ReplayCapsule };
type GestureAction = "replay" | "screenshot" | "region";

const PROMPT_PRESETS = [
  "이 상황이 어떻게 된 건지 설명해줘",
  "문제 원인과 해결 방법을 찾아줘",
  "여기서 다음에 무엇을 해야 하는지 알려줘",
];

const AIRPOINTER_PROTOCOL = "airpointer://";

export function ReplayWorkspace() {
  const screenVideo = useRef<HTMLVideoElement>(null);
  const [companionToken, setCompanionToken] = useState("");
  const buffer = useRef(new BrowserReplayBuffer(3 * 60_000));
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [retention, setRetention] = useState(3);
  const [sendSeconds, setSendSeconds] = useState(15);
  const [status, setStatus] = useState<Status>("idle");
  const [frames, setFrames] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState("");
  const [message, setMessage] = useState("화면 공유를 시작하면 최근 장면이 이 기기에만 쌓입니다.");
  const [elapsed, setElapsed] = useState(0);
  const [gestureEnabled, setGestureEnabled] = useState(false);
  const [gestureActions, setGestureActions] = useState({ replay: true, screenshot: true, region: true });
  const [agentThreads, setAgentThreads] = useState<AgentThread[]>([]);
  const [agentThreadId, setAgentThreadId] = useState("");
  const [agentState, setAgentState] = useState<AgentState>("loading");
  const [agentMessage, setAgentMessage] = useState("Codex 작업을 불러오는 중입니다.");
  const [pendingCapture, setPendingCapture] = useState<PendingAgentCapture | null>(null);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [companionMessage, setCompanionMessage] = useState("");

  const stopSharing = useCallback(() => {
    stream?.getTracks().forEach((track) => track.stop());
    buffer.current.stop();
    setStream(null);
    setElapsed(0);
    setStatus("idle");
    setMessage("버퍼를 비웠습니다. 화면 데이터는 남아 있지 않습니다.");
  }, [stream]);

  const startSharing = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus("error"); setMessage("이 브라우저는 화면 공유를 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해 주세요."); return;
    }
    try {
      const nextStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 24 } }, audio: false });
      if (!screenVideo.current) return;
      screenVideo.current.srcObject = nextStream;
      await screenVideo.current.play();
      buffer.current.setRetention(retention);
      buffer.current.start(nextStream);
      nextStream.getVideoTracks()[0].addEventListener("ended", () => {
        buffer.current.stop(); setStream(null); setElapsed(0); setStatus("idle"); setMessage("화면 공유가 종료되어 버퍼를 비웠습니다.");
      }, { once: true });
      setStream(nextStream);
      setFrames([]); setAnalysis(""); setStatus("recording"); setMessage("기록 중입니다. 트리거 전에는 어떤 화면도 서버로 보내지 않습니다.");
    } catch (reason) {
      const denied = reason instanceof DOMException && reason.name === "NotAllowedError";
      setStatus("error"); setMessage(denied ? "화면 공유가 취소되었습니다. 준비되면 다시 시작해 주세요." : "화면 공유를 시작하지 못했습니다.");
    }
  }, [retention]);

  const captureFrames = useCallback(async (mode: Mode) => {
    if (!stream || !screenVideo.current) throw new Error("먼저 화면 공유를 시작해 주세요.");
    const nextFrames = mode === "current" ? [frameFromVideo(screenVideo.current)] : await buffer.current.recentFrames(sendSeconds, 6);
    if (!nextFrames.length) throw new Error("전송할 만큼 화면 버퍼가 아직 쌓이지 않았습니다.");
    setFrames(nextFrames);
    return nextFrames;
  }, [sendSeconds, stream]);

  const analyzeWithOpenAI = useCallback(async (mode: Mode) => {
    if (!stream || !screenVideo.current) { setStatus("error"); setMessage("먼저 화면 공유를 시작해 주세요."); return; }
    setStatus("preparing"); setAnalysis("");
    try {
      const nextFrames = await captureFrames(mode);
      setStatus("analyzing"); setMessage(`${mode === "current" ? "현재 화면" : `최근 ${sendSeconds}초`}을 OpenAI API가 분석하고 있습니다.`);
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, frames: nextFrames }) });
      const data = await response.json() as { analysis?: string; error?: string };
      if (!response.ok || !data.analysis) throw new Error(data.error || "분석 결과를 받지 못했습니다.");
      setAnalysis(data.analysis); setStatus("done"); setMessage("분석이 끝났습니다. 전송한 프레임은 서버에 저장하지 않습니다.");
    } catch (reason) {
      setStatus("error"); setMessage(reason instanceof Error ? reason.message : "전송에 실패했습니다.");
    }
  }, [captureFrames, sendSeconds, stream]);

  const loadAgentThreads = useCallback(async () => {
    setAgentState("loading"); setAgentMessage("Codex 작업을 불러오는 중입니다.");
    try {
      const response = await fetch("/api/agent", { cache: "no-store" });
      const data = await response.json() as { available?: boolean; threads?: AgentThread[]; error?: string };
      if (!response.ok || !data.available) throw new Error(data.error || "Codex Agent에 연결하지 못했습니다.");
      const nextThreads = data.threads || [];
      setAgentThreads(nextThreads);
      setAgentThreadId((current) => {
        const saved = window.localStorage.getItem("airpointer-agent-thread") || "";
        if (nextThreads.some((thread) => thread.id === current)) return current;
        return nextThreads.some((thread) => thread.id === saved) ? saved : "";
      });
      setAgentState("idle");
      setAgentMessage(nextThreads.length ? "전송할 Codex 작업을 선택해 주세요." : "전송 가능한 Codex 작업이 없습니다.");
    } catch (reason) {
      setAgentThreads([]); setAgentState("error");
      setAgentMessage(reason instanceof Error ? reason.message : "Codex Agent 연결에 실패했습니다.");
    }
  }, []);

  const postToAgent = useCallback(async (payload: { threadId: string; mode: Mode; seconds: number; frames: string[]; userPrompt: string }) => {
    for (let attempt = 0; attempt < 31; attempt += 1) {
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { delivered?: boolean; queued?: boolean; turnId?: string; error?: string };
      if (response.ok && data.delivered) return data;
      if (response.status !== 409 || !data.queued || attempt === 30) throw new Error(data.error || "Codex Agent 전송에 실패했습니다.");
      setAgentState("queued"); setAgentMessage("선택한 작업이 실행 중입니다. 캡처를 보관하고 자동 재시도합니다.");
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    throw new Error("Codex 작업이 계속 실행 중이라 전송하지 못했습니다.");
  }, []);

  const postCapsuleToAgent = useCallback(async (form: FormData) => {
    for (let attempt = 0; attempt < 31; attempt += 1) {
      const response = await fetch("/api/agent", { method: "POST", body: form });
      const data = await response.json() as { delivered?: boolean; queued?: boolean; turnId?: string; error?: string };
      if (response.ok && data.delivered) return data;
      if (response.status !== 409 || !data.queued || attempt === 30) throw new Error(data.error || "Codex Agent 전송에 실패했습니다.");
      setAgentState("queued"); setAgentMessage("선택한 작업이 실행 중입니다. Replay Capsule을 보관하고 자동 재시도합니다.");
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
    }
    throw new Error("Codex 작업이 계속 실행 중이라 전송하지 못했습니다.");
  }, []);

  const prepareAgentCapture = useCallback(async (mode: Mode) => {
    if (!agentThreadId) { setAgentState("error"); setAgentMessage("먼저 전송할 Codex 작업을 선택해 주세요."); return; }
    if (!stream || !screenVideo.current) { setAgentState("error"); setAgentMessage("먼저 화면 공유를 시작해 주세요."); return; }
    setAgentState("preparing");
    try {
      setAgentMessage(`${mode === "current" ? "현재 화면" : `최근 ${sendSeconds}초`} 맥락을 고정하고 있습니다.`);
      if (mode === "replay") {
        const capsule = await buffer.current.recentCapsule(sendSeconds, 6);
        if (!capsule.overviewFrames.length || !capsule.segments.length) throw new Error("전송할 만큼 화면 버퍼가 아직 쌓이지 않았습니다.");
        setFrames(capsule.overviewFrames);
        setPendingCapture({ mode, threadId: agentThreadId, seconds: sendSeconds, capsule });
      } else {
        const nextFrames = await captureFrames("current");
        setPendingCapture({ mode, threadId: agentThreadId, seconds: sendSeconds, frames: nextFrames });
      }
      setAgentPrompt("");
      setAgentState("drafting");
      setAgentMessage("맥락을 고정했습니다. 질문을 입력하기 전에는 Agent로 전송되지 않습니다.");
    } catch (reason) {
      setAgentState("error"); setAgentMessage(reason instanceof Error ? reason.message : "화면 맥락을 준비하지 못했습니다.");
    }
  }, [agentThreadId, captureFrames, sendSeconds, stream]);

  const cancelPendingCapture = useCallback(() => {
    if (agentState === "sending" || agentState === "queued") return;
    setPendingCapture(null); setAgentPrompt(""); setAgentState("idle");
    setAgentMessage("전송을 취소했습니다. 고정한 맥락은 Agent로 보내지지 않았습니다.");
  }, [agentState]);

  const submitPendingCapture = useCallback(async () => {
    const prompt = agentPrompt.trim();
    if (!pendingCapture || !prompt || agentState === "sending" || agentState === "queued") return;
    setAgentState("sending");
    setAgentMessage("질문과 고정한 화면 맥락을 Codex Agent에 전송하고 있습니다.");
    try {
      let data: { turnId?: string };
      if (pendingCapture.mode === "replay") {
        const { capsule } = pendingCapture;
        const form = new FormData();
        form.set("metadata", JSON.stringify({ threadId: pendingCapture.threadId, mode: pendingCapture.mode, seconds: pendingCapture.seconds, userPrompt: prompt, startedAt: capsule.startedAt, triggeredAt: capsule.triggeredAt, segments: capsule.segments.map(({ startedAt, durationMs, blob }) => ({ startedAt, durationMs, mimeType: blob.type })) }));
        capsule.overviewFrames.forEach((frame, index) => form.append("overview", dataUrlToBlob(frame), `overview-${String(index + 1).padStart(2, "0")}.jpg`));
        capsule.segments.forEach((segment, index) => form.append("segment", segment.blob, `segment-${String(index + 1).padStart(3, "0")}.webm`));
        data = await postCapsuleToAgent(form);
      } else {
        data = await postToAgent({ threadId: pendingCapture.threadId, mode: pendingCapture.mode, seconds: pendingCapture.seconds, frames: pendingCapture.frames, userPrompt: prompt });
      }
      const label = pendingCapture.mode === "replay" ? `최근 ${pendingCapture.seconds}초 Replay Capsule` : pendingCapture.region ? "선택 영역" : "현재 화면";
      setPendingCapture(null); setAgentPrompt(""); setAgentState("done");
      setAgentMessage(`${label}과 질문을 Codex 작업에 보냈습니다. (${data.turnId})`);
    } catch (reason) {
      setAgentState("error"); setAgentMessage(reason instanceof Error ? reason.message : "Codex Agent 전송에 실패했습니다.");
    }
  }, [agentPrompt, agentState, pendingCapture, postCapsuleToAgent, postToAgent]);

  const changeGestureEnabled = useCallback((enabled: boolean) => {
    // External protocols must be opened while the trusted click is still active.
    // Calling this later from the asynchronous camera-ready callback is blocked by Chrome.
    const token = enabled ? window.crypto.randomUUID() : companionToken;
    launchAirPointer(enabled ? "start" : "quit", token);
    setCompanionToken(enabled ? token : "");
    setGestureEnabled(enabled);
    setCompanionMessage(enabled ? "AirPointer를 시작하고 있습니다." : "");
  }, [companionToken]);

  const setGestureAction = useCallback((action: GestureAction, enabled: boolean) => {
    setGestureActions((current) => ({ ...current, [action]: enabled }));
  }, []);

  const { pose, progress: gestureProgress, preview: companionPreview, selection: gestureSelection, error: gestureError, ready: companionReady } = useCompanionGesture({ enabled: gestureEnabled, token: companionToken, agentThreadId, gestures: gestureActions });

  useEffect(() => {
    if (!stream) return;
    const timer = window.setInterval(() => setElapsed(buffer.current.status().durationMs), 1_000);
    return () => window.clearInterval(timer);
  }, [stream]);
  useEffect(() => { buffer.current.setRetention(retention); }, [retention]);
  useEffect(() => () => buffer.current.stop(), []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadAgentThreads(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAgentThreads]);
  useEffect(() => {
    if (!pendingCapture) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") cancelPendingCapture(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelPendingCapture, pendingCapture]);

  const bufferPercent = Math.min(100, (elapsed / (retention * 60_000)) * 100);
  const timeLabel = formatDuration(elapsed);
  const stateLabel = useMemo(() => ({ idle: "대기", recording: "로컬 기록 중", preparing: "프레임 준비", analyzing: "AI 분석 중", done: "분석 완료", error: "확인 필요" })[status], [status]);
  const agentStateLabel = useMemo(() => ({ loading: "연결 중", idle: "AGENT 대기", preparing: "맥락 고정 중", drafting: "프롬프트 대기", sending: "AGENT 전송 중", queued: "AGENT 전송 대기", done: "AGENT 전송 완료", error: "AGENT 확인 필요" })[agentState], [agentState]);

  return (
    <main className={styles.shell}>
      <header className={styles.nav}>
        <a className={styles.brand} href="#top" aria-label="방금그거뭐였지 홈"><span className={styles.brandMark} aria-hidden="true">↺</span><span>방금그거뭐였지</span></a>
        <div className={styles.navMeta}><span className={styles.localBadge}><LockKey size={14} weight="bold" /> LOCAL BUFFER</span><a href="#how">작동 원리</a><a href="#privacy">개인정보</a></div>
      </header>

      <section className={styles.hero} id="top">
        <div className={styles.stageColumn}>
          <div className={styles.stageHeader}><span>LIVE DESKTOP</span><span>{stream ? "CAPTURING" : "NOT CONNECTED"}</span></div>
          <div className={styles.stage}>
            <video ref={screenVideo} className={`${styles.screenVideo} ${stream ? styles.visible : ""}`} muted playsInline />
            {!stream && <div className={styles.emptyStage}><Desktop size={54} weight="thin" /><strong>방금 지나간 화면을 놓치지 마세요</strong><span>공유한 화면은 브라우저 메모리 안에서만 순환합니다.</span><button className={styles.primary} onClick={() => void startSharing()}><Play size={18} weight="fill" /> 화면 공유 시작</button></div>}
            {stream && <div className={styles.liveFlag}><span /> REC</div>}
            <div className={styles.nowLine} style={{ left: `${Math.max(2, bufferPercent)}%` }}><span>NOW</span></div>
          </div>
          <div className={styles.transport}>
            <span className={styles.timecode}>{timeLabel}</span>
            <div className={styles.bufferTrack} aria-label={`버퍼 ${Math.round(bufferPercent)}퍼센트`}><span style={{ width: `${bufferPercent}%` }} /></div>
            <span>{retention}:00</span>
            {stream ? <button className={styles.iconButton} onClick={stopSharing} aria-label="화면 공유 중지"><Stop size={16} weight="fill" /></button> : <button className={styles.iconButton} onClick={() => void startSharing()} aria-label="화면 공유 시작"><Play size={16} weight="fill" /></button>}
          </div>
        </div>

        <aside className={styles.commandDock}>
          <p className={styles.eyebrow}>REPLAY TO AGENT</p>
          <div className={`${styles.cameraPanel} ${styles.commandCamera}`}>{companionPreview && <img src={companionPreview} alt="AirPointer 카메라 미리보기" />}<div className={styles.cameraHud}><span><HandPalm size={16} /> {pose === "palm" ? "손바닥 인식" : pose === "fist" ? "주먹 인식" : pose === "point" ? "검지 인식" : pose === "none" ? "손 찾는 중" : "동작 대기"}</span><span>CAM 01 · EXE</span></div>{gestureEnabled && gestureProgress.phase !== "idle" && gestureSelection.phase === "idle" && <div className={styles.gestureTimer} data-active role="progressbar" aria-label="제스처 유지 시간" aria-valuemin={0} aria-valuemax={1} aria-valuenow={gestureProgress.value}><div className={styles.gestureTimerRing} style={{ background: `conic-gradient(var(--accent) ${gestureProgress.value * 360}deg, rgba(255,255,255,.14) 0deg)` }}><span><b>{Math.round(gestureProgress.value * 100)}</b></span></div><p>손바닥 2초</p></div>}</div>
          <div className={styles.gestureControls}><label className={styles.switch}><input type="checkbox" checked={gestureEnabled} onChange={(event) => changeGestureEnabled(event.target.checked)} /><span /><b>{gestureEnabled ? "제스처 + AirPointer 켜짐" : "제스처 + AirPointer 켜기"}</b></label></div>
          <div className={styles.gestureActions} aria-label="제스처별 설정">
            <GestureActionToggle label="손바닥 2초" detail="15초 REPLAY" checked={gestureActions.replay} disabled={!gestureEnabled} onChange={(value) => setGestureAction("replay", value)} />
            <GestureActionToggle label="손바닥 → 주먹" detail="현재 화면" checked={gestureActions.screenshot} disabled={!gestureEnabled} onChange={(value) => setGestureAction("screenshot", value)} />
            <GestureActionToggle label="주먹 → 손바닥" detail="영역 선택" checked={gestureActions.region} disabled={!gestureEnabled} onChange={(value) => setGestureAction("region", value)} />
          </div>
          {(gestureError || (!companionReady && companionMessage)) && <small className={styles.gestureError}>{gestureError || companionMessage}</small>}
          <div className={styles.rule} />
          <label className={styles.field}><span>로컬 버퍼</span><select value={retention} onChange={(event) => setRetention(Number(event.target.value))} disabled={Boolean(stream)}><option value={1}>최근 1분</option><option value={3}>최근 3분</option><option value={5}>최근 5분</option></select></label>
          <label className={styles.field}><span>전송 구간</span><select value={sendSeconds} onChange={(event) => setSendSeconds(Number(event.target.value))}><option value={5}>최근 5초</option><option value={15}>최근 15초</option><option value={30}>최근 30초</option><option value={60}>최근 1분</option></select></label>
          <label className={styles.field}><span>Codex Agent</span><span className={styles.agentPicker}><select aria-label="전송할 Codex 작업" value={agentThreadId} onChange={(event) => { setAgentThreadId(event.target.value); window.localStorage.setItem("airpointer-agent-thread", event.target.value); setAgentState("idle"); setAgentMessage(event.target.value ? "제스처 전송 준비가 끝났습니다." : "전송할 Codex 작업을 선택해 주세요."); }} disabled={agentState === "loading"}><option value="">작업 선택</option>{agentThreads.map((thread) => <option value={thread.id} key={thread.id}>{thread.status === "active" ? "● " : ""}{thread.title}</option>)}</select><button type="button" onClick={() => void loadAgentThreads()} aria-label="Codex 작업 새로고침"><ArrowClockwise size={15} /></button></span></label>
          <button className={styles.action} onClick={() => void prepareAgentCapture("replay")} disabled={!stream || !agentThreadId || agentState === "preparing" || agentState === "sending" || agentState === "queued"}><PaperPlaneTilt size={20} weight="bold" /> 최근 {sendSeconds}초 Agent에 묻기</button>
          <button className={styles.secondary} onClick={() => void prepareAgentCapture("current")} disabled={!stream || !agentThreadId || agentState === "preparing" || agentState === "sending" || agentState === "queued"}><Camera size={18} /> 지금 화면 Agent에 묻기</button>
          <div className={styles.status} data-tone={agentState === "error" ? "error" : agentState === "done" ? "done" : "normal"}>{agentState === "loading" || agentState === "preparing" || agentState === "sending" || agentState === "queued" ? <CircleNotch className={styles.spin} size={16} /> : agentState === "error" ? <WarningCircle size={16} /> : agentState === "done" ? <Check size={16} /> : <span className={styles.statusDot} />}<div><strong>{agentStateLabel}</strong><span>{agentMessage}</span></div></div>
          <div className={styles.apiDivider}><span>별도 기능</span><b>OPENAI IMAGE ANALYSIS</b></div>
          <button className={styles.secondary} onClick={() => void analyzeWithOpenAI("replay")} disabled={!stream || status === "analyzing"}><ArrowCounterClockwise size={18} /> 최근 {sendSeconds}초 OpenAI 분석</button>
          <button className={styles.secondary} onClick={() => void analyzeWithOpenAI("current")} disabled={!stream || status === "analyzing"}><Camera size={18} /> 현재 화면 OpenAI 분석</button>
          <div className={styles.status} data-tone={status === "error" ? "error" : status === "done" ? "done" : "normal"}>{status === "analyzing" || status === "preparing" ? <CircleNotch className={styles.spin} size={16} /> : status === "error" ? <WarningCircle size={16} /> : status === "done" ? <Check size={16} /> : <span className={styles.statusDot} />}<div><strong>{stateLabel}</strong><span>{message}</span></div></div>
        </aside>
      </section>

      <section className={styles.replaySection} id="how">
        <div className={styles.timelinePanel}>
          <div className={styles.timelineHead}><span>{frames.length ? `${frames.length} FRAMES SENT` : "LOCAL RING BUFFER"}</span><span>오래된 장면 자동 삭제</span></div>
          <div className={styles.frames}>
            {frames.length ? frames.map((frame, index) => <figure key={`${frame.slice(-24)}-${index}`}>{/* Browser-generated data URLs are intentionally not passed through Next image optimization. */}<img src={frame} alt={`AI에 전송한 ${index + 1}번째 화면`} /><figcaption>-{Math.max(0, sendSeconds - Math.round((index * sendSeconds) / Math.max(1, frames.length - 1)))}s</figcaption></figure>) : Array.from({ length: 6 }, (_, index) => <div className={styles.framePlaceholder} key={index}><span>{index + 1}</span></div>)}
          </div>
          <div className={styles.ruler}><span /><i style={{ left: `${bufferPercent}%` }} /></div>
        </div>
        <AnimatePresence mode="wait">
          {(status === "analyzing" || analysis) && <motion.article className={styles.analysis} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><div className={styles.analysisLabel}><span>AI</span><p>{status === "analyzing" ? "화면 변화 읽는 중" : "방금 일어난 일"}</p></div><div>{status === "analyzing" ? <div className={styles.analysisLoading}><span /><span /><span /></div> : <p>{analysis}</p>}</div></motion.article>}
        </AnimatePresence>
      </section>

      <section className={styles.gestureSection} id="privacy">
        <div className={styles.gestureCopy}><p className={styles.eyebrow}>GESTURE SHORTCUT</p><h2>화면에서 손을<br />떼지 않아도 됩니다.</h2><p>손바닥 2초는 최근 15초, 손바닥 다음 주먹은 현재 화면을 Agent에게 보냅니다. 주먹 다음 손바닥은 영역 선택을 시작하며, 레이저 포인터는 이 때만 표시됩니다.</p></div>
        <div className={styles.privacyList}><div><strong>01</strong><p><b>기기 안에서만</b><span>최근 1~5분은 브라우저 메모리에만 존재합니다.</span></p></div><div><strong>02</strong><p><b>필요한 순간만</b><span>트리거한 구간의 대표 프레임만 AI에 전송합니다.</span></p></div><div><strong>03</strong><p><b>공유 종료 즉시</b><span>화면 공유를 끄면 순환 버퍼도 바로 비웁니다.</span></p></div></div>
      </section>

      {stream && gestureSelection.phase !== "idle" && <div className={styles.selectionLayer} data-phase={gestureSelection.phase} role="dialog" aria-modal="true" aria-label="화면 영역 캡처">
        {gestureSelection.rect ? <>
          <span className={styles.selectionShade} style={{ left: 0, top: 0, width: "100%", height: `${gestureSelection.rect.top * 100}%` }} />
          <span className={styles.selectionShade} style={{ left: 0, top: `${gestureSelection.rect.bottom * 100}%`, width: "100%", bottom: 0 }} />
          <span className={styles.selectionShade} style={{ left: 0, top: `${gestureSelection.rect.top * 100}%`, width: `${gestureSelection.rect.left * 100}%`, height: `${(gestureSelection.rect.bottom - gestureSelection.rect.top) * 100}%` }} />
          <span className={styles.selectionShade} style={{ left: `${gestureSelection.rect.right * 100}%`, right: 0, top: `${gestureSelection.rect.top * 100}%`, height: `${(gestureSelection.rect.bottom - gestureSelection.rect.top) * 100}%` }} />
          <span className={styles.selectionBox} style={{ left: `${gestureSelection.rect.left * 100}%`, top: `${gestureSelection.rect.top * 100}%`, width: `${(gestureSelection.rect.right - gestureSelection.rect.left) * 100}%`, height: `${(gestureSelection.rect.bottom - gestureSelection.rect.top) * 100}%` }}><b>{Math.round((gestureSelection.rect.right - gestureSelection.rect.left) * 100)}% × {Math.round((gestureSelection.rect.bottom - gestureSelection.rect.top) * 100)}%</b></span>
        </> : <div className={styles.selectionStart}><strong>AREA CAPTURE</strong><span>검지를 세워 첫 모서리를 잡으세요</span></div>}
        {gestureSelection.pointer && <span className={styles.selectionPointer} style={{ left: `${gestureSelection.pointer.x * 100}%`, top: `${gestureSelection.pointer.y * 100}%` }} />}
        {gestureSelection.rect && <div className={styles.selectionInstruction}>{gestureSelection.phase === "confirming" ? `주먹 유지 ${Math.round(gestureSelection.progress * 100)}%` : gestureSelection.phase === "cooldown" ? "CAPTURED" : "검지로 크기 조절 · 주먹으로 확정"}</div>}
      </div>}

      <AnimatePresence>
        {pendingCapture && <motion.div className={styles.promptBackdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.section className={styles.promptDialog} role="dialog" aria-modal="true" aria-labelledby="agent-prompt-title" initial={{ opacity: 0, y: 24, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: .98 }}>
            <div className={styles.promptHeader}><div><p>CAPTURE LOCKED · NOT SENT</p><h2 id="agent-prompt-title">Agent에게 무엇을 물어볼까요?</h2></div><button type="button" onClick={cancelPendingCapture} disabled={agentState === "sending" || agentState === "queued"} aria-label="질문 창 닫기"><X size={20} /></button></div>
            <div className={styles.captureSummary}><span>{pendingCapture.mode === "replay" ? `최근 ${pendingCapture.seconds}초 맥락` : pendingCapture.region ? "선택 영역" : "현재 화면"}</span><b>{pendingCapture.mode === "replay" ? `${pendingCapture.capsule.overviewFrames.length}개 개요 + 원본 구간` : "1개 화면"}</b></div>
            <div className={styles.promptChoices} aria-label="추천 질문">{PROMPT_PRESETS.map((preset) => <button type="button" key={preset} onClick={() => setAgentPrompt(preset)} aria-pressed={agentPrompt === preset}>{preset}</button>)}</div>
            <label className={styles.promptInput}><span>직접 질문</span><textarea autoFocus value={agentPrompt} maxLength={2000} placeholder="예: 0.5초 전에 잠깐 뜬 오류가 뭐였고 어떻게 해결해?" onChange={(event) => setAgentPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submitPendingCapture(); } }} /></label>
            <div className={styles.promptFooter}><p><b>{agentPrompt.length}</b> / 2000 · Enter 전송 · Shift+Enter 줄바꿈</p><div><button type="button" className={styles.promptCancel} onClick={cancelPendingCapture} disabled={agentState === "sending" || agentState === "queued"}>취소</button><button type="button" className={styles.promptSend} onClick={() => void submitPendingCapture()} disabled={!agentPrompt.trim() || agentState === "sending" || agentState === "queued"}>{agentState === "sending" || agentState === "queued" ? <CircleNotch className={styles.spin} size={17} /> : <PaperPlaneTilt size={17} weight="bold" />} 질문과 함께 전송</button></div></div>
          </motion.section>
        </motion.div>}
      </AnimatePresence>

      <footer className={styles.footer}><span>방금그거뭐였지</span><span>AI Championship 2026 Prototype</span><span>Built for moments that disappear.</span></footer>
    </main>
  );
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function GestureActionToggle({ label, detail, checked, disabled, onChange }: { label: string; detail: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <label className={styles.gestureAction} data-active={checked && !disabled}><span><b>{label}</b><small>{detail}</small></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i>{checked ? "ON" : "OFF"}</i></label>;
}

function launchAirPointer(command: "start" | "quit", token: string) {
  if (["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
    void fetch("/api/companion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, token }),
    });
    return;
  }
  // This is an external OS protocol, not an internal Next.js route.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `${AIRPOINTER_PROTOCOL}${command}?token=${encodeURIComponent(token)}`;
}

function dataUrlToBlob(value: string) {
  const [header, payload] = value.split(",", 2);
  const mimeType = /^data:([^;]+);base64$/.exec(header)?.[1] || "image/jpeg";
  const binary = window.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}
