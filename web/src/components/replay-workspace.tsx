"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowCounterClockwise, Camera, Check, CircleNotch, Desktop, HandPalm, LockKey, Play, Stop, WarningCircle } from "@phosphor-icons/react";
import { useHandGesture } from "@/hooks/use-hand-gesture";
import { BrowserReplayBuffer, frameFromVideo } from "@/lib/replay-buffer";
import type { GestureCommand } from "@/lib/gesture";
import styles from "./replay-workspace.module.css";

type Status = "idle" | "recording" | "preparing" | "analyzing" | "done" | "error";
type Mode = "current" | "replay";

export function ReplayWorkspace() {
  const screenVideo = useRef<HTMLVideoElement>(null);
  const cameraVideo = useRef<HTMLVideoElement>(null);
  const handCanvas = useRef<HTMLCanvasElement>(null);
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

  const send = useCallback(async (mode: Mode) => {
    if (!stream || !screenVideo.current) { setStatus("error"); setMessage("먼저 화면 공유를 시작해 주세요."); return; }
    setStatus("preparing"); setAnalysis("");
    try {
      const nextFrames = mode === "current" ? [frameFromVideo(screenVideo.current)] : await buffer.current.recentFrames(sendSeconds, 6);
      if (!nextFrames.length) throw new Error("분석할 만큼 버퍼가 아직 쌓이지 않았습니다.");
      setFrames(nextFrames); setStatus("analyzing"); setMessage(`${mode === "current" ? "현재 화면" : `최근 ${sendSeconds}초`}을 AI가 확인하고 있습니다.`);
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, frames: nextFrames }) });
      const data = await response.json() as { analysis?: string; error?: string };
      if (!response.ok || !data.analysis) throw new Error(data.error || "분석 결과를 받지 못했습니다.");
      setAnalysis(data.analysis); setStatus("done"); setMessage("분석이 끝났습니다. 전송한 프레임은 서버에 저장하지 않습니다.");
    } catch (reason) {
      setStatus("error"); setMessage(reason instanceof Error ? reason.message : "전송에 실패했습니다.");
    }
  }, [sendSeconds, stream]);

  const onGesture = useCallback((command: GestureCommand) => { void send(command === "capture-now" ? "current" : "replay"); }, [send]);
  const { pose, error: gestureError } = useHandGesture({ enabled: gestureEnabled, videoRef: cameraVideo, canvasRef: handCanvas, onCommand: onGesture });

  useEffect(() => {
    if (!stream) return;
    const timer = window.setInterval(() => setElapsed(buffer.current.status().durationMs), 1_000);
    return () => window.clearInterval(timer);
  }, [stream]);
  useEffect(() => { buffer.current.setRetention(retention); }, [retention]);
  useEffect(() => () => buffer.current.stop(), []);

  const bufferPercent = Math.min(100, (elapsed / (retention * 60_000)) * 100);
  const timeLabel = formatDuration(elapsed);
  const stateLabel = useMemo(() => ({ idle: "대기", recording: "로컬 기록 중", preparing: "프레임 준비", analyzing: "AI 분석 중", done: "분석 완료", error: "확인 필요" })[status], [status]);

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
          <h1>방금 그거,<br /><em>AI가 봤어.</em></h1>
          <p className={styles.lead}>지나간 오류와 화면 변화를 최근 몇 초의 흐름으로 되돌려 AI에게 보여주세요.</p>
          <div className={styles.rule} />
          <label className={styles.field}><span>로컬 버퍼</span><select value={retention} onChange={(event) => setRetention(Number(event.target.value))} disabled={Boolean(stream)}><option value={1}>최근 1분</option><option value={3}>최근 3분</option><option value={5}>최근 5분</option></select></label>
          <label className={styles.field}><span>전송 구간</span><select value={sendSeconds} onChange={(event) => setSendSeconds(Number(event.target.value))}><option value={5}>최근 5초</option><option value={15}>최근 15초</option><option value={30}>최근 30초</option><option value={60}>최근 1분</option></select></label>
          <button className={styles.action} onClick={() => void send("replay")} disabled={!stream || status === "analyzing"}><ArrowCounterClockwise size={20} weight="bold" /> 최근 {sendSeconds}초 AI에게 보내기</button>
          <button className={styles.secondary} onClick={() => void send("current")} disabled={!stream || status === "analyzing"}><Camera size={18} /> 지금 화면만 보내기</button>
          <div className={styles.status} data-tone={status === "error" ? "error" : status === "done" ? "done" : "normal"}>{status === "analyzing" || status === "preparing" ? <CircleNotch className={styles.spin} size={16} /> : status === "error" ? <WarningCircle size={16} /> : status === "done" ? <Check size={16} /> : <span className={styles.statusDot} />}<div><strong>{stateLabel}</strong><span>{message}</span></div></div>
        </aside>
      </section>

      <section className={styles.replaySection} id="how">
        <div className={styles.sectionTitle}><span>01</span><div><p>THE LAST MOMENTS</p><h2>결과가 아니라,<br />문제가 생긴 <em>과정</em>을 봅니다.</h2></div></div>
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
        <div className={styles.gestureCopy}><p className={styles.eyebrow}>GESTURE SHORTCUT</p><h2>화면에서 손을<br />떼지 않아도 됩니다.</h2><p>손바닥을 유지하면 최근 장면을, 손바닥 다음 주먹은 지금 화면을 보냅니다. 손이 사라져야 다음 명령이 활성화됩니다.</p><label className={styles.switch}><input type="checkbox" checked={gestureEnabled} onChange={(event) => setGestureEnabled(event.target.checked)} /><span /><b>{gestureEnabled ? "제스처 켜짐" : "제스처 켜기"}</b></label>{gestureError && <small>{gestureError}</small>}</div>
        <div className={styles.cameraPanel}><video ref={cameraVideo} muted playsInline /><canvas ref={handCanvas} /><div className={styles.cameraHud}><span><HandPalm size={16} /> {pose === "palm" ? "손바닥 인식" : pose === "fist" ? "주먹 인식" : pose === "none" ? "손 찾는 중" : "동작 대기"}</span><span>CAM 01</span></div></div>
        <div className={styles.privacyList}><div><strong>01</strong><p><b>기기 안에서만</b><span>최근 1~5분은 브라우저 메모리에만 존재합니다.</span></p></div><div><strong>02</strong><p><b>필요한 순간만</b><span>트리거한 구간의 대표 프레임만 AI에 전송합니다.</span></p></div><div><strong>03</strong><p><b>공유 종료 즉시</b><span>화면 공유를 끄면 순환 버퍼도 바로 비웁니다.</span></p></div></div>
      </section>

      <footer className={styles.footer}><span>방금그거뭐였지</span><span>AI Championship 2026 Prototype</span><span>Built for moments that disappear.</span></footer>
    </main>
  );
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
