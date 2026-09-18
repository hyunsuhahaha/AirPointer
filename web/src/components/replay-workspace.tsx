"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowCounterClockwise, Broadcast, Camera, Check, CircleNotch, DownloadSimple, LockKey, MagnifyingGlass, PictureInPicture, Pause, Play, ShieldCheck, Sparkle, Stop, Target, WarningCircle } from "@phosphor-icons/react";
import { useReplayPlayback } from "@/hooks/use-replay-playback";
import { BrowserReplayBuffer, DEFAULT_CAPTURE_INTERVAL_MS, cropRegion, frameFromVideo, replayGapOffsets, surroundingReplayOffsets, withReplayBookmarks } from "@/lib/replay-buffer";
import type { ChangeHighlight, NormalizedBox, OverviewFrame, ReplayCapsule } from "@/lib/replay-buffer";
import { createPrivacyRedactor } from "@/lib/privacy-redaction";
import type { PrivacyReport } from "@/lib/privacy-redaction";
import { closeScreenOcr, recognizeScreenText } from "@/lib/screen-ocr";
import { memoryFrameFromVideo, saveScreenMemoryFrame, updateScreenMemoryFrame } from "@/lib/screen-memory";
import type { ScreenMemoryFrame } from "@/lib/screen-memory";
import { formatReplayRange } from "@/lib/replay-frame-request";
import type { ReplayExplorationRequest } from "@/lib/replay-frame-request";
import styles from "./replay-workspace.module.css";
import { EvidenceTimeMachine, PrivacyZoneEditor, RegionCapture } from "./browser-capture-panel";
import { AgentExportPanel } from "./agent-export-panel";
import { ProjectOverview } from "./project-overview";
import { UsageExamples } from "./usage-examples/usage-examples";
import type { DeliveryMode } from "./usage-examples/usage-examples";
import { IncidentReview } from "./incident-review";
import type { Incident } from "@/lib/incident-report";
import { ModeGuide } from "./mode-guide";
import { ThemePicker } from "./theme-picker";
import { ScreenMemoryWorkbench } from "./screen-memory-workbench";
import { DayTimeline } from "./day-timeline";
import { DayTimelineDemo } from "./day-timeline-demo";
import { useDayLogRecorder, useDayTimelineSettings } from "@/hooks/use-day-log-recorder";
import { requestPersistence } from "@/lib/day-log-store";
import type { AnalysisModelId, CaptureMetadata, CaptureSnapshot } from "@/lib/analysis-payload";
import type { AnalysisMode, AnalysisTiming, EvidenceItem, ExplorationProgress } from "./browser-capture-panel";

// Document Picture-in-Picture (Chrome/Edge 116+) isn't in TS's DOM lib yet --
// minimal ambient shape for the one method/property this file actually uses.
// The window it hands back is a real same-origin Window (own document, same
// JS realm as the opener), just chromeless and always-on-top -- close
// enough to a global hotkey's "reachable no matter what else has focus"
// without any native install, which is the whole point of pipWindow below.
declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options?: { width?: number; height?: number; preferInitialWindowPlacement?: boolean }): Promise<Window>;
      window: Window | null;
    };
  }
}

const PIP_STYLE_MARKER = "data-whatwas-pip-styles";

function startPipStyleSync(source: Document, target: Document): () => void {
  const style = target.createElement("style");
  style.setAttribute(PIP_STYLE_MARKER, "");
  const nonce = source.querySelector<HTMLElement>("style[nonce],link[nonce],script[nonce]")?.nonce;
  if (nonce) style.nonce = nonce;
  target.head.append(style);

  let previousCss = "";
  const sync = () => {
    if (!target.defaultView || target.defaultView.closed) return;
    target.documentElement.className = source.documentElement.className;
    const css = Array.from(source.styleSheets, (sheet) => {
      try {
        return Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
      } catch {
        return "";
      }
    }).join("\n");
    if (css === previousCss) return;
    style.textContent = css;
    previousCss = css;
  };

  sync();
  const observer = new MutationObserver(sync);
  observer.observe(source.head, { attributes: true, childList: true, characterData: true, subtree: true });
  // Theme changes only touch <html>'s classes.
  observer.observe(source.documentElement, { attributes: true, attributeFilter: ["class"] });
  // Next's dev runtime can replace CSS rules through CSSOM without changing
  // a DOM node. Production styles are static, so polling there only burns CPU.
  const timer = process.env.NODE_ENV === "development" ? window.setInterval(sync, 2_000) : null;
  return () => {
    observer.disconnect();
    if (timer !== null) window.clearInterval(timer);
    style.remove();
  };
}

type Status = "idle" | "recording" | "preparing" | "analyzing" | "done" | "error";
type Mode = "current" | "replay";
// The PiP capture window's two shapes (see openCapturePip): "buttons" is the
// always-floating minimal trigger pair, "conversation" is the fuller
// Codex-Desktop-like thread view that opens only when there's something to
// show -- Document PiP allows only one window per tab, so these are never
// both open at once; switching between them closes one and opens the other.
// Outer sizes for PiP resizeTo; requestWindow takes the inner size, so the
// minimized bar asks for its content height there.
const PIP_MINIMIZED_SIZE: [number, number] = [340, 96];
const PIP_MINIMIZED_INNER_HEIGHT = 56;
const PIP_MANUAL_SIZE: [number, number] = [520, 560];
type ConversationTurn = { role: "user" | "assistant"; text: string };
type StageBox = { left: number; top: number; width: number; height: number };
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

// The "active stage" sweep below is a decorative CSS-only loop, not a readout
// of actual phase state.
const BROWSER_PIPELINE_STAGES = [
  { Icon: Camera, label: "화면 캡처", detail: "순환 버퍼에 프레임 기록" },
  { Icon: Sparkle, label: "변화 감지", detail: "바뀐 순간만 골라냄" },
  { Icon: Target, label: "대표 프레임 선택", detail: "핵심 장면으로 압축" },
  { Icon: MagnifyingGlass, label: "맥락 문서 생성", detail: "변화 시각과 화면 파일 연결" },
  { Icon: Check, label: "Agent 내보내기", detail: "폴더 탐색 또는 파일 첨부" },
];

const STAGE_MIN_WIDTH = 320;
const STAGE_MIN_HEIGHT = 220;
const REPLAY_FRAME_BUDGET = 18;
const MAX_REPLAY_BOOKMARKS = 6;
const REPLAY_MAX_ROUNDS = 6;

const RESIZE_DIRS: { dir: ResizeDir; label: string }[] = [
  { dir: "n", label: "위쪽" },
  { dir: "s", label: "아래쪽" },
  { dir: "e", label: "오른쪽" },
  { dir: "w", label: "왼쪽" },
  { dir: "ne", label: "오른쪽 위 대각선" },
  { dir: "nw", label: "왼쪽 위 대각선" },
  { dir: "se", label: "오른쪽 아래 대각선" },
  { dir: "sw", label: "왼쪽 아래 대각선" },
];

// The desktop app's installer, always the newest GitHub release.
const DESKTOP_APP_URL = "https://github.com/hyunsuhahaha/AirPointer/releases/latest/download/whatwas-setup.exe";
const noSubscription = () => () => undefined;

export function ReplayWorkspace() {
  const screenVideo = useRef<HTMLVideoElement>(null);
  const stageViewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageMoveStart = useRef<{ pointerX: number; pointerY: number; box: StageBox } | null>(null);
  const stageResizeStart = useRef<{ pointerX: number; pointerY: number; box: StageBox; dir: ResizeDir } | null>(null);
  const [stageBox, setStageBox] = useState<StageBox | null>(null);
  const buffer = useRef(new BrowserReplayBuffer(3 * 60_000));
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [retention, setRetention] = useState(3);
  const [sendSeconds, setSendSeconds] = useState(15);
  const [captureIntervalMs, setCaptureIntervalMs] = useState(DEFAULT_CAPTURE_INTERVAL_MS);
  const changeRetention = (minutes: number) => {
    setRetention(minutes);
    setSendSeconds((current) => Math.min(current, minutes * 60));
  };
  const [status, setStatus] = useState<Status>("idle");
  const [frames, setFrames] = useState<OverviewFrame[]>([]);
  const [replayBookmarks, setReplayBookmarks] = useState<OverviewFrame[]>([]);
  const memoryOcrQueue = useRef<Promise<void>>(Promise.resolve());
  const [analysis, setAnalysis] = useState("");
  const [resultFocus, setResultFocus] = useState(true);
  const [analysisRevision, setAnalysisRevision] = useState(0);
  const [incident, setIncident] = useState<Incident | undefined>();
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const timeline = useDayTimelineSettings();
  // The day timeline records only after its own start button, and only while sharing.
  const [timelineOn, setTimelineOn] = useState(false);
  const [timelineExampleOpen, setTimelineExampleOpen] = useState(false);
  const timelineActive = timelineOn && Boolean(stream);
  const { bookmark: bookmarkToday, status: labelerStatus } = useDayLogRecorder({ enabled: timelineActive, retention: timeline.retention, interval: timeline.interval, stream, videoRef: screenVideo, bufferRef: buffer });
  const [workQuestion, setWorkQuestion] = useState("");
  const [captureContext, setCaptureContext] = useState("");
  const [analysisEvidence, setAnalysisEvidence] = useState<EvidenceItem[]>([]);
  const [analysisEvidencePreview, setAnalysisEvidencePreview] = useState<number | null>(null);
  const [exploration, setExploration] = useState<ExplorationProgress | undefined>();
  const analysisSectionRef = useRef<HTMLElement>(null);
  const [privacyEnabled, setPrivacyEnabled] = useState(true);
  const [privacyZone, setPrivacyZone] = useState<NormalizedBox | undefined>();
  const [privacyReport, setPrivacyReport] = useState<PrivacyReport | undefined>();
  const [privacyImage, setPrivacyImage] = useState<CaptureSnapshot | null>(null);
  // "방금 뭐가 바뀌었나" highlight card -- the single most notable detected
  // change in the send window, as a before/after pair plus a zoomed crop.
  // Recomputed on a timer (see the effect near `elapsed` below), not on
  // every render, since it involves an async canvas crop.
  const [highlight, setHighlight] = useState<ChangeHighlight | null>(null);
  const [highlightZoomUrl, setHighlightZoomUrl] = useState("");
  // Default on: screen sharing itself is already the explicit permission
  // step (see PRODUCT.md's "명시적 허용 후에만 기록" principle) -- deciding
  // whether a *detected* change also gets surfaced is a much smaller
  // decision layered on top of that, so it doesn't need its own opt-in to
  // stay consistent with it. Kept visible/toggleable so it's never a silent
  // watcher -- see the switch next to the highlight panel below.
  const [proactiveDetectionEnabled, setProactiveDetectionEnabled] = useState(true);
  // "browser" is the export workbench; "full" adds a direct OpenAI check,
  // privacy masking and the persistent screen memory.
  const [viewMode, setViewMode] = useState<"browser" | "full">("browser");
  const insideDesktopApp = useSyncExternalStore(noSubscription, () => Boolean(window.whatwasNative), () => false);
  const [message, setMessage] = useState("화면 공유를 시작하면 최근 장면이 이 기기에만 쌓입니다.");
  const [elapsed, setElapsed] = useState(0);
  // Refreshed with `elapsed`: the recorded span and the wall clock the
  // transport scrubber measures against.
  const [bufferBounds, setBufferBounds] = useState<{ start: number; end: number } | null>(null);
  const [clock, setClock] = useState(0);
  // No-install work-mode trigger: an always-on-top floating window with its
  // own buttons. It is requested automatically after screen sharing starts;
  // the visible switch remains only as a close/retry control.
  const pipWindowRef = useRef<Window | null>(null);
  const pipStyleCleanupRef = useRef<(() => void) | null>(null);
  const openCapturePipRef = useRef<(expanded?: boolean, minimized?: boolean) => Promise<boolean>>(async () => false);
  const [pipSupported, setPipSupported] = useState(false);
  const [pipOpen, setPipOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [examplesMode, setExamplesMode] = useState<DeliveryMode | undefined>();
  // Document PiP has no minimize API, so "minimize" shrinks the window to the
  // status bar and remembers the size to restore. Lives here, not in the
  // export panel, because the panel remounts whenever the share changes.
  const [pipMinimized, setPipMinimized] = useState(false);
  const pipRestoreSize = useRef<[number, number] | null>(null);
  const [pipHalfScreen, setPipHalfScreen] = useState(false);
  const [pipMessage, setPipMessage] = useState("");
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const [regionImage, setRegionImage] = useState<CaptureSnapshot | null>(null);
  const analysisInFlight = useRef(false);
  const analysisController = useRef<AbortController | null>(null);
  const retryCapture = useRef<{ key: string; frames: OverviewFrame[]; metadata?: CaptureMetadata; capsule: ReplayCapsule | null } | null>(null);
  const replayCapsuleRef = useRef<ReplayCapsule | null>(null);
  // Deliberately deferred to an effect (not a useState lazy initializer)
  // so the first client render matches the SSR pass (window is undefined
  // there too) before this flips post-mount -- an inline/lazy-initializer
  // check would read `window` during the client's very first render and
  // mismatch the server-rendered markup instead.
  // Document PiP freezes the page inside the desktop app, which has its own tray and shortcut instead.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPipSupported(typeof window !== "undefined" && "documentPictureInPicture" in window && !window.whatwasNative); }, []);
  // The desktop app grants the screen without a picker and signals when the page may start.
  const startSharingRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    const start = () => { void startSharingRef.current(); };
    window.addEventListener("whatwas-native-ready", start);
    void window.whatwasNative?.pageReady();
    return () => window.removeEventListener("whatwas-native-ready", start);
  }, []);

  const getStageBox = useCallback((): StageBox => {
    if (stageBox) return stageBox;
    const stageRect = stageRef.current?.getBoundingClientRect();
    const viewportRect = stageViewportRef.current?.getBoundingClientRect();
    if (!stageRect || !viewportRect) return { left: 0, top: 0, width: 640, height: 410 };
    return { left: stageRect.left - viewportRect.left, top: stageRect.top - viewportRect.top, width: stageRect.width, height: stageRect.height };
  }, [stageBox]);

  const resetStageBox = useCallback(() => setStageBox(null), []);

  const beginStageMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    event.preventDefault();
    const box = getStageBox();
    stageMoveStart.current = { pointerX: event.clientX, pointerY: event.clientY, box };
    document.body.style.userSelect = "none";
    const onMove = (moveEvent: PointerEvent) => {
      if (!stageMoveStart.current) return;
      const { pointerX, pointerY, box } = stageMoveStart.current;
      setStageBox({ ...box, left: box.left + (moveEvent.clientX - pointerX), top: box.top + (moveEvent.clientY - pointerY) });
    };
    const onUp = () => {
      stageMoveStart.current = null;
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [getStageBox]);

  const resizeBoxFromDelta = (box: StageBox, dir: ResizeDir, dx: number, dy: number): StageBox => {
    let { left, top, width, height } = box;
    if (dir.includes("e")) width = Math.max(STAGE_MIN_WIDTH, box.width + dx);
    if (dir.includes("w")) { width = Math.max(STAGE_MIN_WIDTH, box.width - dx); left = box.left + (box.width - width); }
    if (dir.includes("s")) height = Math.max(STAGE_MIN_HEIGHT, box.height + dy);
    if (dir.includes("n")) { height = Math.max(STAGE_MIN_HEIGHT, box.height - dy); top = box.top + (box.height - height); }
    return { left, top, width, height };
  };

  const beginStageResize = useCallback((event: React.PointerEvent<HTMLButtonElement>, dir: ResizeDir) => {
    event.preventDefault();
    event.stopPropagation();
    const box = getStageBox();
    stageResizeStart.current = { pointerX: event.clientX, pointerY: event.clientY, box, dir };
    document.body.style.userSelect = "none";
    const onMove = (moveEvent: PointerEvent) => {
      if (!stageResizeStart.current) return;
      const { pointerX, pointerY, box, dir } = stageResizeStart.current;
      setStageBox(resizeBoxFromDelta(box, dir, moveEvent.clientX - pointerX, moveEvent.clientY - pointerY));
    };
    const onUp = () => {
      stageResizeStart.current = null;
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }, [getStageBox]);

  const onStageResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>, dir: ResizeDir) => {
    const horizontal = dir.includes("e") || dir.includes("w");
    const vertical = dir.includes("n") || dir.includes("s");
    let dx = 0;
    let dy = 0;
    if (horizontal && event.key === "ArrowLeft") dx = -20;
    else if (horizontal && event.key === "ArrowRight") dx = 20;
    else if (vertical && event.key === "ArrowUp") dy = -20;
    else if (vertical && event.key === "ArrowDown") dy = 20;
    else return;
    event.preventDefault();
    setStageBox(resizeBoxFromDelta(getStageBox(), dir, dx, dy));
  }, [getStageBox]);

  const stopSharing = useCallback(() => {
    analysisController.current?.abort(); retryCapture.current = null; replayCapsuleRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    buffer.current.stop();
    setStream(null);
    setHighlight(null); setHighlightZoomUrl("");
    setElapsed(0);
    setStatus("idle");
    setMessage("순환 버퍼를 비웠습니다. 분석 결과와 직접 저장한 기록은 별도로 관리됩니다.");
    setRegionImage(null);
    setReplayBookmarks([]);
    setTimelineOn(false);
  }, [stream]);

  const startSharing = useCallback(async () => {
    analysisController.current?.abort(); retryCapture.current = null;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus("error"); setMessage("이 브라우저는 화면 공유를 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해 주세요."); return false;
    }
    try {
      const nextStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 24 } }, audio: false });
      if (!screenVideo.current) return false;
      // Chrome restores transient activation after the display picker closes.
      // Request PiP immediately, before awaiting video playback or doing any
      // setup work, so the same explicit "화면 공유 시작" click can authorize
      // both parts of browser work mode.
      const pipPromise = openCapturePipRef.current(false, true);
      setRegionImage(null);
      setHighlight(null); setHighlightZoomUrl("");
      screenVideo.current.srcObject = nextStream;
      await screenVideo.current.play();
      buffer.current.setRetention(retention);
      buffer.current.start(nextStream);
      nextStream.getVideoTracks()[0].addEventListener("ended", () => {
        analysisController.current?.abort(); retryCapture.current = null; replayCapsuleRef.current = null; buffer.current.stop(); setStream(null); setElapsed(0); setStatus("idle"); setMessage("화면 공유가 종료되어 버퍼를 비웠습니다.");
        setHighlight(null); setHighlightZoomUrl(""); setRegionImage(null);
        setReplayBookmarks([]); setTimelineOn(false);
      }, { once: true });
      setStream(nextStream);
      setReplayBookmarks([]);
      setFrames([]); setAnalysis(""); setIncident(undefined); setAnalysisEvidence([]); setAnalysisEvidencePreview(null); setExploration(undefined); setStatus("recording"); setMessage("기록 중입니다. 트리거 전에는 어떤 화면도 서버로 보내지 않습니다.");
      await pipPromise;
      return true;
    } catch (reason) {
      const denied = reason instanceof DOMException && reason.name === "NotAllowedError";
      setStatus("error"); setMessage(denied ? "화면 공유가 취소되었습니다. 준비되면 다시 시작해 주세요." : "화면 공유를 시작하지 못했습니다.");
      return false;
    }
  }, [retention]);
  useEffect(() => { startSharingRef.current = async () => { if (!stream) await startSharing(); }; }, [startSharing, stream]);
  const startTimeline = useCallback(async () => {
    if (!stream && !await startSharing()) return;
    void requestPersistence();
    setTimelineOn(true);
  }, [startSharing, stream]);

  const captureFrames = useCallback(async (mode: Mode) => {
    if (!stream || !screenVideo.current) throw new Error("먼저 화면 공유를 시작해 주세요.");
    let nextFrames: OverviewFrame[];
    if (mode === "current") {
      replayCapsuleRef.current = null;
      nextFrames = [{ url: frameFromVideo(screenVideo.current), atSeconds: 0, capturedAt: Date.now() }];
    } else {
      const capsule = await buffer.current.recentCapsule(sendSeconds, 6);
      nextFrames = withReplayBookmarks(capsule.overviewFrames, replayBookmarks, capsule.triggeredAt, MAX_REPLAY_BOOKMARKS);
      replayCapsuleRef.current = { ...capsule, overviewFrames: nextFrames };
    }
    if (!nextFrames.length) throw new Error("전송할 만큼 화면 버퍼가 아직 쌓이지 않았습니다.");
    setFrames(nextFrames);
    return nextFrames;
  }, [replayBookmarks, sendSeconds, stream]);

  // All browser triggers share one request guard, including the PiP portal.
  const analyzeWithOpenAI = useCallback(async (mode: AnalysisMode, question?: string, history?: ConversationTurn[], image?: CaptureSnapshot, model?: AnalysisModelId): Promise<{ text: string; captureContext?: string; evidence?: EvidenceItem[]; exploration?: ExplorationProgress; privacy?: PrivacyReport } | { error: string }> => {
    if (mode !== "text" && !image && (!stream || !screenVideo.current)) {
      const error = "먼저 화면 공유를 시작해 주세요.";
      setStatus("error"); setMessage(error);
      return { error };
    }
    if (analysisInFlight.current) return { error: "이전 분석이 끝난 뒤 다시 보내주세요." };
    analysisInFlight.current = true;
    setAnalysisRevision(value => value + 1);
    const controller = new AbortController();
    analysisController.current = controller;
    const assertActive = () => { if (controller.signal.aborted) throw new DOMException("분석 취소", "AbortError"); };
    const retryKey = JSON.stringify([mode, question, image?.capturedAt, stream?.id, sendSeconds]);
    const retained = retryCapture.current?.key === retryKey ? retryCapture.current : null;
    let privacyRedactor: Awaited<ReturnType<typeof createPrivacyRedactor>> | undefined;
    const redactedCache = new Map<string, { url: string; regions: { category: string }[] }>();
    let latestPrivacy: PrivacyReport | undefined;
    const analysisStartedAt = performance.now();
    const timing: AnalysisTiming = { totalMs: 0, captureMs: 0, privacyMs: 0, apiMs: 0, replayMs: 0, evidenceMs: 0 };
    setStatus("preparing"); setAnalysis(""); setIncident(undefined); setCaptureContext(""); setAnalysisEvidence([]); setAnalysisEvidencePreview(null); setExploration(undefined); setPrivacyReport(undefined);
    try {
      const captureStartedAt = performance.now();
      const nextFrames: OverviewFrame[] = retained ? retained.frames : mode === "text" ? [] : image ? [{ url: image.url, atSeconds: 0, capturedAt: image.capturedAt }] : await captureFrames(mode);
      timing.captureMs += performance.now() - captureStartedAt;
      assertActive();
      if (retained) replayCapsuleRef.current = retained.capsule;
      if (image) setFrames(nextFrames);
      const settings = stream?.getVideoTracks()[0]?.getSettings();
      const surface = image?.surface ?? settings?.displaySurface;
      const metadata: CaptureMetadata | undefined = retained ? retained.metadata : mode === "text" ? undefined : {
        capturedAt: Date.now(),
        surface: surface === "browser" || surface === "window" || surface === "monitor" ? surface : "unknown",
        width: image?.width ?? screenVideo.current!.videoWidth,
        height: image?.height ?? screenVideo.current!.videoHeight,
        requestedSeconds: mode === "replay" ? sendSeconds : 0,
        selection: image?.selection,
        images: nextFrames.map(frame => ({
          kind: image ? "selection" : mode === "current" ? "screen" : frame.kind ?? "change-crop",
          offsetsSeconds: image || mode === "current" ? [0] : frame.sampleOffsetsSeconds ?? [],
        })),
      };
      retryCapture.current = { key: retryKey, frames: nextFrames, metadata, capsule: replayCapsuleRef.current };
      setStatus("analyzing"); setMessage(`${mode === "text" ? "질문" : image ? "선택 영역" : mode === "current" ? "현재 화면" : `최근 ${sendSeconds}초`}을 OpenAI API가 분석하고 있습니다.`);
      const bookmarkFrameCount = nextFrames.filter((frame) => frame.kind === "bookmarked-frame").length;
      const frameBudget = mode === "replay" ? REPLAY_FRAME_BUDGET + bookmarkFrameCount : nextFrames.length;
      let round = 0;
      let progress: ExplorationProgress | undefined = mode === "replay" ? { active: true, usedFrames: nextFrames.length, frameBudget, round, maxRounds: REPLAY_MAX_ROUNDS, steps: [{ label: bookmarkFrameCount ? `대표 프레임 6장 + 북마크 ${bookmarkFrameCount}장 확인` : `대표 프레임 ${nextFrames.length}장 확인`, detail: nextFrames.map((frame) => `${frame.kind === "bookmarked-frame" ? "북마크 " : ""}-${frame.atSeconds.toFixed(2)}초`).join(" · "), added: nextFrames.length, status: "working" }] } : undefined;
      if (progress) setExploration(progress);
      const requestAnalysis = async (requestFrames: OverviewFrame[], requestMetadata?: CaptureMetadata, currentProgress?: ExplorationProgress) => {
        const replayExploration = currentProgress ? { round: currentProgress.round, maxRounds: currentProgress.maxRounds, frameBudget: currentProgress.frameBudget, usedFrames: requestFrames.length } : undefined;
        const transmittedFrames: string[] = [];
        if (privacyEnabled && mode !== "text") {
          const privacyStartedAt = performance.now();
          privacyRedactor ??= await createPrivacyRedactor((detail) => setMessage(`전송 전 개인정보 보호 · ${detail}`));
          for (const frame of requestFrames) {
            let redacted = redactedCache.get(frame.url);
            if (!redacted) {
              redacted = await privacyRedactor.redact(frame, privacyZone);
              assertActive();
              redactedCache.set(frame.url, redacted);
            }
            transmittedFrames.push(redacted.url);
          }
          const entries = [...redactedCache.entries()];
          const masked = entries.filter(([, result]) => result.regions.length);
          latestPrivacy = {
            enabled: true, scannedFrames: entries.length, maskedFrames: masked.length,
            maskedRegions: entries.reduce((total, [, result]) => total + result.regions.length, 0),
            categories: [...new Set(entries.flatMap(([, result]) => result.regions.map((region) => region.category)))],
            preview: masked[0] ? { beforeUrl: masked[0][0], afterUrl: masked[0][1].url } : entries[0] ? { beforeUrl: entries[0][0], afterUrl: entries[0][1].url } : undefined,
          };
          setPrivacyReport(latestPrivacy);
          timing.privacyMs += performance.now() - privacyStartedAt;
        } else transmittedFrames.push(...requestFrames.map((frame) => frame.url));
        assertActive();
        if (mode !== "text") setFrames(requestFrames.map((frame, index) => ({ ...frame, url: transmittedFrames[index] })));
        const apiStartedAt = performance.now();
        const response = await fetch("/api/analyze", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]), method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, model, frames: transmittedFrames, question, history, metadata: requestMetadata, exploration: replayExploration }) });
        timing.apiMs += performance.now() - apiStartedAt;
        const data = await response.json() as { analysis?: string; incident?: Incident; error?: string; captureContext?: string; explorationRequests?: ReplayExplorationRequest[]; evidence?: { frameIndex: number; claim: string }[] };
        assertActive();
        if (!response.ok) throw new Error(data.error || "분석 결과를 받지 못했습니다.");
        return data;
      };
      let analyzedFrames = nextFrames;
      let analyzedMetadata = metadata;
      let data = await requestAnalysis(analyzedFrames, analyzedMetadata, progress);
      if (progress) {
        progress = { ...progress, steps: progress.steps.map((step, index) => index === progress!.steps.length - 1 ? { ...step, status: "done" } : step) };
        setExploration(progress);
      }
      const requestSignatures = new Set<string>();
      while (mode === "replay" && data.explorationRequests?.length && analyzedMetadata && progress) {
        const replayStartedAt = performance.now();
        round += 1;
        const remaining = Math.max(0, frameBudget - analyzedFrames.length);
        const additions: OverviewFrame[] = [];
        const details: string[] = [];
        const frameOffsets = data.explorationRequests.flatMap((request) => request.type === "frames" ? request.offsetsSeconds : []);
        const cropRequest = data.explorationRequests.find((request): request is Extract<ReplayExplorationRequest, { type: "crop" }> => request.type === "crop");
        if (cropRequest) {
          const requested = analyzedFrames[cropRequest.frameIndex];
          const candidate = requested;
          if (candidate) progress = { ...progress, round, steps: [...progress.steps,
            { label: `-${candidate.atSeconds.toFixed(2)}초 오류 후보 발견`, detail: "AI가 답변에 필요한 순간을 특정했습니다.", added: 0, status: "done" },
            { label: "단서 영역 확대", detail: `${analyzedFrames.indexOf(candidate) + 1}번 프레임의 작은 글씨를 원본 해상도로 읽는 중`, added: 0, status: "working" },
          ] };
        } else {
          progress = { ...progress, round, steps: [...progress.steps, { label: `${formatReplayRange(frameOffsets)} 구간 재탐색`, detail: "로컬 영상에서 중간 프레임을 꺼내는 중", added: 0, status: "working" }] };
        }
        setExploration(progress);
        for (const request of data.explorationRequests) {
          if (additions.length >= remaining) break;
          if (request.type === "frames") {
            let offsets = request.offsetsSeconds.filter((offset) => {
              const signature = `frame:${offset.toFixed(3)}`;
              if (requestSignatures.has(signature) || analyzedFrames.some((frame) => Math.abs(frame.atSeconds - Math.abs(offset)) < 0.04)) return false;
              requestSignatures.add(signature); return true;
            }).slice(0, remaining - additions.length);
            if (!offsets.length) offsets = replayGapOffsets(analyzedFrames, Math.min(3, remaining - additions.length)).filter((offset) => {
              const signature = `frame:${offset.toFixed(3)}`;
              if (requestSignatures.has(signature)) return false;
              requestSignatures.add(signature); return true;
            });
            if (!offsets.length) continue;
            setMessage(`AI가 ${offsets.map((offset) => `${offset}초`).join(", ")} 구간을 더 촘촘히 탐색하고 있습니다.`);
            const found = replayCapsuleRef.current ? await buffer.current.framesAtOffsets(replayCapsuleRef.current, offsets) : [];
            additions.push(...found.slice(0, remaining - additions.length));
            details.push(offsets.map((offset) => `${offset}초`).join(" · "));
          } else {
            const cropBox = request.bbox;
            const signature = `crop:${request.frameIndex}:${cropBox.map((value) => value.toFixed(3)).join(":")}`;
            const requestedSource = analyzedFrames[request.frameIndex];
            const source = requestedSource;
            if (!source || requestSignatures.has(signature)) continue;
            requestSignatures.add(signature);
            const sourceIndex = analyzedFrames.indexOf(source);
            setMessage(`AI가 ${sourceIndex + 1}번 프레임의 작은 글씨를 원본 해상도로 확대하고 있습니다.`);
            additions.push({ ...source, url: await cropRegion(source.url, cropBox, 0.04), kind: "queried-crop", focusBox: cropBox });
            details.push(`${sourceIndex + 1}번 프레임 영역 확대`);
          }
        }
        progress = { ...progress, round: additions.length ? round : REPLAY_MAX_ROUNDS, usedFrames: analyzedFrames.length + additions.length, steps: progress.steps.map((step, index) => index === progress!.steps.length - 1 ? { ...step, detail: `${details.join(" · ") || "중복 요청 제외"}${additions.length ? " · AI 판독 중" : " · 최종 답변으로 전환"}`, added: additions.length, status: "working" } : step) };
        setExploration(progress);
        if (additions.length) {
          analyzedFrames = [...analyzedFrames, ...additions].slice(0, frameBudget);
          analyzedMetadata = { ...analyzedMetadata, images: analyzedFrames.map((frame) => ({ kind: frame.kind ?? "change-crop", offsetsSeconds: frame.sampleOffsetsSeconds ?? [] })) };
          if (!privacyEnabled) setFrames(analyzedFrames);
        }
        timing.replayMs += performance.now() - replayStartedAt;
        data = await requestAnalysis(analyzedFrames, analyzedMetadata, progress);
        progress = { ...progress, steps: progress.steps.map((step, index) => index === progress!.steps.length - 1 ? { ...step, detail: step.detail.replace(" · AI 판독 중", " · 판독 완료"), status: "done" } : step) };
        setExploration(progress);
      }
      assertActive();
      if (!data.analysis) throw new Error(data.error || "분석 결과를 받지 못했습니다.");
      if (progress) {
        progress = { ...progress, steps: [...progress.steps, { label: "근거 확보 중", detail: "답변에 연결할 전후 프레임을 로컬에서 준비하는 중", added: 0, status: "working" }] };
        setExploration(progress);
      }
      const evidenceStartedAt = performance.now();
      const evidence = await Promise.all((data.evidence ?? []).flatMap(({ frameIndex, claim }) => analyzedFrames[frameIndex] ? [{ claim, frame: analyzedFrames[frameIndex] }] : []).map(async ({ claim, frame }) => {
        const offsets = surroundingReplayOffsets(frame.atSeconds, sendSeconds);
        const timeline = mode !== "replay" ? [frame] : replayCapsuleRef.current ? await buffer.current.framesAtOffsets(replayCapsuleRef.current, offsets) : [frame];
        const safeFrame = { ...frame, url: redactedCache.get(frame.url)?.url ?? frame.url };
        return { claim, frame: safeFrame, timeline: timeline.length ? timeline : [frame], focusBox: frame.focusBox } satisfies EvidenceItem;
      }));
      assertActive();
      retryCapture.current = null;
      timing.evidenceMs += performance.now() - evidenceStartedAt;
      timing.totalMs = performance.now() - analysisStartedAt;
      const completedProgress = progress ? { ...progress, active: false, usedFrames: analyzedFrames.length, timing, steps: progress.steps.map((step, index) => index === progress!.steps.length - 1 ? { ...step, label: "근거 확보 완료", detail: `답변에 연결할 화면 근거 ${evidence.length}개 확인`, status: "done" as const } : step) } : undefined;
      if (completedProgress) setExploration(completedProgress);
      setAnalysisEvidence(evidence);
      const privacyReceipt = latestPrivacy ? `\n\n개인정보 보호\n브라우저 로컬 검사: ${latestPrivacy.scannedFrames}장 · 가림: ${latestPrivacy.maskedRegions}곳${latestPrivacy.categories.length ? ` (${latestPrivacy.categories.join(", ")})` : ""}\n서버에는 가림 처리된 사본만 전송했습니다.` : "";
      const nextCaptureContext = `${data.captureContext ?? ""}${privacyReceipt}`.trim();
      setCaptureContext(nextCaptureContext); setResultFocus(true); setAnalysis(data.analysis); setIncident(data.incident); setStatus("done"); setMessage("분석이 끝났습니다. 원본은 로컬에만 남고 전송 프레임은 서버에 저장하지 않습니다.");
      return { text: data.analysis, captureContext: nextCaptureContext, evidence, exploration: completedProgress, privacy: latestPrivacy };
    } catch (reason) {
      if (controller.signal.aborted) return { error: "분석이 취소되었습니다." };
      const error = reason instanceof Error ? reason.message : "전송에 실패했습니다.";
      setStatus("error"); setMessage(error);
      return { error };
    } finally {
      try { await privacyRedactor?.close(); } finally { analysisInFlight.current = false; }
    }
  }, [captureFrames, privacyEnabled, privacyZone, sendSeconds, stream]);


  const snapshot = useCallback(() => {
    if (!stream || !screenVideo.current) throw new Error("먼저 화면 공유를 시작해 주세요.");
    const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
    return { url: frameFromVideo(screenVideo.current), capturedAt: Date.now(), width: screenVideo.current.videoWidth, height: screenVideo.current.videoHeight,
      surface: surface === "browser" || surface === "window" || surface === "monitor" ? surface : "unknown" } satisfies CaptureSnapshot;
  }, [stream]);

  const addMemoryFrameToReplay = useCallback((memoryFrame: ScreenMemoryFrame) => {
    const frame = { url: memoryFrame.imageUrl, capturedAt: memoryFrame.capturedAt, atSeconds: 0, sampleOffsetsSeconds: [0], kind: "bookmarked-frame" } satisfies OverviewFrame;
    setReplayBookmarks((current) => [...current.filter((item) => item.url !== frame.url), frame].slice(-MAX_REPLAY_BOOKMARKS));
  }, []);

  // `minimized` opens the window as the status bar only.
  const openCapturePip = useCallback(async (expanded = false, minimized = false): Promise<boolean> => {
    const current = pipWindowRef.current;
    if (current && !current.closed) {
      setPipOpen(true);
      return true;
    }
    if (window.whatwasNative) return false;
    if (!window.documentPictureInPicture) {
      setPipMessage("이 브라우저는 항상 위 캡처 창을 지원하지 않습니다.");
      return false;
    }
    setPipMessage("");
    try {
      // Chrome otherwise reopens at the size the user last dragged the PiP to.
      const pipWindow = await window.documentPictureInPicture.requestWindow({
        ...(minimized
          ? { width: PIP_MINIMIZED_SIZE[0], height: PIP_MINIMIZED_INNER_HEIGHT }
          : { width: expanded ? 390 : 370, height: expanded ? 560 : 260 }),
        preferInitialWindowPlacement: true,
      });
      pipWindowRef.current = pipWindow;
      pipWindow.document.title = "AI 내보내기";
      pipWindow.document.documentElement.lang = "ko";
      pipWindow.document.documentElement.className = document.documentElement.className;
      pipWindow.document.body.style.cssText = "margin:0;background:var(--t-panel, #111210)";
      // The portal shares React state, but PiP has its own document. Keep the
      // compiled CSS in sync because Next dev replaces CSS modules during HMR.
      pipStyleCleanupRef.current?.();
      pipStyleCleanupRef.current = startPipStyleSync(document, pipWindow.document);
      if (pipWindow.closed) return false;
      setPipContainer(pipWindow.document.body);
      setPipOpen(true);
      pipRestoreSize.current = null;
      setPipMinimized(minimized);
      setPipHalfScreen(false);
      pipWindow.addEventListener("pagehide", () => {
        if (pipWindowRef.current !== pipWindow) return;
        pipStyleCleanupRef.current?.();
        pipStyleCleanupRef.current = null;
        pipWindowRef.current = null;
        setPipContainer(null);
        setPipOpen(false);
        setPipMinimized(false);
        setPipHalfScreen(false);
      }, { once: true });
      return true;
    } catch (reason) {
      pipStyleCleanupRef.current?.();
      pipStyleCleanupRef.current = null;
      pipWindowRef.current?.close();
      pipWindowRef.current = null;
      setPipContainer(null);
      setPipMessage(reason instanceof Error ? reason.message : "떠 있는 캡처 창을 열지 못했습니다.");
      setPipOpen(false);
      return false;
    }
  }, []);
  useEffect(() => { openCapturePipRef.current = openCapturePip; }, [openCapturePip]);
  const changePipMinimized = useCallback((next: boolean, restoreSize?: [number, number]) => {
    const pip = pipWindowRef.current;
    setPipMinimized(next);
    if (!pip || pip.closed) return;
    try {
      if (next) {
        pipRestoreSize.current = [pip.outerWidth, pip.outerHeight];
        pip.resizeTo(Math.min(pip.outerWidth, PIP_MINIMIZED_SIZE[0]), PIP_MINIMIZED_SIZE[1]);
      } else {
        if (restoreSize) setPipHalfScreen(false);
        const [width, height] = restoreSize ?? pipRestoreSize.current ?? PIP_MANUAL_SIZE;
        pip.resizeTo(width, height);
      }
    } catch { /* The browser owns PiP sizing; the panel still collapses. */ }
  }, []);
  // Half the screen: half the available width, full available height. PiP
  // windows cannot be moved from script, so the browser keeps its anchor.
  const changePipHalfScreen = useCallback((next: boolean) => {
    const pip = pipWindowRef.current;
    if (!pip || pip.closed) return;
    setPipHalfScreen(next);
    try {
      if (next) pip.resizeTo(Math.round(pip.screen.availWidth / 2), pip.screen.availHeight);
      else pip.resizeTo(...PIP_MANUAL_SIZE);
    } catch { /* The browser owns PiP sizing. */ }
  }, []);

  const closeCapturePip = useCallback(() => {
    pipStyleCleanupRef.current?.();
    pipStyleCleanupRef.current = null;
    pipWindowRef.current?.close();
    pipWindowRef.current = null;
    setPipContainer(null);
    setPipOpen(false);
    setPipMinimized(false);
    setPipHalfScreen(false);
  }, []);

  useEffect(() => () => {
    pipStyleCleanupRef.current?.();
    pipWindowRef.current?.close();
  }, []);

  useEffect(() => {
    if (!stream) return;
    const tick = () => {
      setElapsed(buffer.current.status().durationMs);
      setBufferBounds(buffer.current.timelineBounds());
      setClock(Date.now());
    };
    const timer = window.setInterval(tick, 1_000);
    return () => { window.clearInterval(timer); setBufferBounds(null); };
  }, [stream]);
  useEffect(() => {
    // Masked at render (`stream &&` on the highlight card below), not reset
    // here, so this effect never needs a setState-in-effect just to zero
    // things out on stop. Disabling the toggle stops the polling outright
    // (not just the render) so an unwatched tab isn't still cropping images
    // every second for a panel nobody sees.
    if (!stream || !proactiveDetectionEnabled) return;
    let cancelled = false;
    let lastAfterUrl = "";
    const timer = window.setInterval(() => {
      const next = buffer.current.recentHighlight(sendSeconds);
      if ((next?.afterUrl ?? "") === lastAfterUrl) return;
      lastAfterUrl = next?.afterUrl ?? "";
      setHighlight(next);
      if (next) void cropRegion(next.afterUrl, next.bbox).then((zoomUrl) => { if (!cancelled) setHighlightZoomUrl(zoomUrl); });
      else setHighlightZoomUrl("");
    }, 1_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [stream, sendSeconds, proactiveDetectionEnabled]);
  useEffect(() => { buffer.current.setRetention(retention); }, [retention]);
  useEffect(() => { buffer.current.setCaptureInterval(captureIntervalMs); }, [captureIntervalMs]);
  useEffect(() => () => { analysisController.current?.abort(); buffer.current.stop(); }, []);
  useEffect(() => () => { void closeScreenOcr(); }, []);
  useEffect(() => {
    if (!stream || !memoryEnabled || viewMode !== "full") return;
    let cancelled = false;
    let lastFingerprint = "";
    let lastStoredAt = 0;
    let working = false;
    const fingerprintDistance = (left: string, right: string) => {
      if (!left || left.length !== right.length) return Infinity;
      let distance = 0;
      for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) distance += 1;
      return distance;
    };
    const persist = async () => {
      const video = screenVideo.current;
      if (cancelled || working || !video || video.readyState < 2 || !video.videoWidth) return;
      working = true;
      try {
        const capturedAt = Date.now();
        const captured = memoryFrameFromVideo(video);
        if (fingerprintDistance(lastFingerprint, captured.fingerprint) < 5 && capturedAt - lastStoredAt < 15_000) return;
        lastFingerprint = captured.fingerprint; lastStoredAt = capturedAt;
        const displaySurface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
        const surface = displaySurface === "browser" || displaySurface === "window" || displaySurface === "monitor" ? displaySurface : "unknown";
        const saved = await saveScreenMemoryFrame({ capturedAt, imageUrl: captured.imageUrl, text: "", source: "timeline", surface, width: captured.width, height: captured.height, bookmarked: false, note: "", tags: [] });
        memoryOcrQueue.current = memoryOcrQueue.current.then(async () => {
          if (cancelled) return;
          const text = await recognizeScreenText(saved.imageUrl);
          if (text) await updateScreenMemoryFrame(saved.id, { text });
        });
      } finally { working = false; }
    };
    const first = window.setTimeout(() => void persist(), 1_000);
    const timer = window.setInterval(() => void persist(), 4_000);
    return () => { cancelled = true; window.clearTimeout(first); window.clearInterval(timer); };
  }, [stream, memoryEnabled, viewMode]);
  const bufferPercent = Math.min(100, (elapsed / (retention * 60_000)) * 100);
  const { videoRef: replayVideoRef, at: replayAt, previewUrl: replayPreviewUrl, playing: replayPlaying, scrub: scrubReplay, seek: seekReplay, play: playReplay, pause: pauseReplay, goLive } = useReplayPlayback(buffer, Boolean(stream));
  const replayAgo = replayAt !== null ? formatDuration(Math.max(0, clock - replayAt)) : "";
  const timeLabel = replayAt !== null ? `-${replayAgo}` : formatDuration(elapsed);
  const stateLabel = useMemo(() => ({ idle: "대기", recording: "로컬 기록 중", preparing: "프레임 준비", analyzing: "AI 분석 중", done: "분석 완료", error: "확인 필요" })[status], [status]);
  const exportPanel = <AgentExportPanel key={stream?.id ?? "idle"} bufferRef={buffer} active={Boolean(stream)} seconds={sendSeconds} bufferMinutes={retention} onBufferMinutesChange={changeRetention} onSecondsChange={setSendSeconds} captureIntervalMs={captureIntervalMs} onCaptureIntervalChange={setCaptureIntervalMs} recording={Boolean(stream)} onStartRecording={() => void startSharing()} onStopRecording={stopSharing} minimized={pipMinimized} onMinimizedChange={changePipMinimized} halfScreen={pipHalfScreen} onHalfScreenChange={pipContainer ? changePipHalfScreen : undefined} surface={stream?.getVideoTracks()[0]?.getSettings().displaySurface ?? "unknown"} onBookmark={timelineActive ? bookmarkToday : undefined} />;

  return (
    <main className={styles.shell}>
      {pipContainer && createPortal(exportPanel, pipContainer)}
      <header className={styles.nav}>
        <a className={styles.brand} href="#top" aria-label="방금그거뭐였지 홈"><span className={styles.brandMark} aria-hidden="true">↺</span><span>방금그거뭐였지</span></a>
        <div className={styles.modeSwitch} role="tablist" aria-label="기능 범위 선택">
          <button type="button" role="tab" aria-selected={viewMode === "browser"} data-active={viewMode === "browser"} onClick={() => setViewMode("browser")}>리플레이 작업대</button>
          <button type="button" role="tab" aria-selected={viewMode === "full"} data-active={viewMode === "full"} onClick={() => setViewMode("full")}>AI 분석</button>
        </div>
        <div className={styles.navMeta}><ThemePicker />{!insideDesktopApp && <a className={styles.appDownload} href={DESKTOP_APP_URL} title="Windows 앱: 공유 창 없이 바로 기록, 앞에 있던 창과 파일 저장까지 기록, 단축키 한 번으로 내보내기"><DownloadSimple size={15} weight="bold" />데스크톱 앱</a>}<span className={styles.localBadge}><LockKey size={14} weight="bold" /> LOCAL BUFFER</span><a href="#how">작동 원리</a><a href="#timeline">오늘 타임라인</a><a href="#pipeline">파이프라인</a></div>
      </header>

      {overviewOpen && <ProjectOverview onClose={() => setOverviewOpen(false)} onShowExamples={() => { setOverviewOpen(false); setExamplesOpen(true); }} />}
      {examplesOpen && <UsageExamples mode={examplesMode} onClose={() => { setExamplesOpen(false); setExamplesMode(undefined); }} />}
      {/* Phones can't share a screen, so they get the pitch and the examples instead of dead controls. */}
      <section className={styles.mobileIntro} aria-label="모바일 소개">
        <p>이 사이트가 하는 일</p>
        <h2>방금 지나간 화면을<br />설명 대신 AI에게 그대로</h2>
        <ol>
          <li><b>01</b><span>PC에서 화면 공유를 켜두면 최근 1~5분이 내 기기에만 쌓여요.</span></li>
          <li><b>02</b><span>버튼 한 번이면 그 순간의 화면과 변화 기록이 파일로 묶여요.</span></li>
          <li><b>03</b><span>ChatGPT·Claude 같은 AI에 그대로 넘기면 상황을 다시 설명할 필요가 없어요.</span></li>
        </ol>
        <div>
          <button type="button" className={styles.primary} onClick={() => setExamplesOpen(true)}><Play size={16} weight="fill" /> 실제 활용 예시 보기</button>
          <button type="button" className={styles.secondary} onClick={() => setOverviewOpen(true)}>프로젝트 개요</button>
        </div>
        <small>화면 기록은 PC의 크롬·엣지에서 동작해요. 폰에서는 예시 애니메이션으로 확인해 주세요.</small>
      </section>
      <section className={styles.intro} id="top"><div><p>SHOW CONTEXT. GET ANSWERS.</p><h1>방금그거뭐였지<span>AI에게 상황을 다시 설명하지 않아도 되는 도구</span></h1><button type="button" className={styles.overviewButton} onClick={() => setOverviewOpen(true)}><Play size={15} weight="fill" /> 프로젝트 개요</button></div><span className={styles.introIndex}>01 — 03<br /><b>공유 → 내보내기 → 전달</b></span></section>
      <section hidden={Boolean(analysis) && resultFocus && viewMode === "browser"} className={styles.hero}>
        <div className={styles.stageColumn}>
          <div className={styles.stageHeader}><span>LIVE DESKTOP</span><span>{stream ? "CAPTURING" : "NOT CONNECTED"}</span></div>
          <div className={styles.stageViewport} ref={stageViewportRef}>
            <div
              className={styles.stage}
              ref={stageRef}
              style={stageBox ? { left: stageBox.left, top: stageBox.top, width: stageBox.width, height: stageBox.height } : undefined}
              onPointerDown={viewMode === "full" ? beginStageMove : undefined}
              onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("button, a")) resetStageBox(); }}
            >
              <video ref={screenVideo} className={`${styles.screenVideo} ${stream ? styles.visible : ""}`} muted playsInline />
              <video ref={replayVideoRef} className={`${styles.screenVideo} ${replayAt !== null && !replayPreviewUrl ? styles.visible : ""}`} muted playsInline aria-hidden="true" />
              {replayPreviewUrl && <img className={styles.replayPreview} src={replayPreviewUrl} alt="" />}
              {replayAt !== null && <div className={styles.replayBar} role="group" aria-label="지난 화면 재생">
                <span>지난 화면 · {replayAgo} 전</span>
                <button type="button" onClick={replayPlaying ? pauseReplay : playReplay} aria-label={replayPlaying ? "일시정지" : "재생"}>{replayPlaying ? <Pause size={13} weight="fill" /> : <Play size={13} weight="fill" />}</button>
                <button type="button" onClick={goLive}><Broadcast size={13} /> LIVE로 돌아가기</button>
              </div>}
              {!stream && <div className={styles.emptyStage}>
                <span className={styles.sceneNumber}>REAL USE CASES</span>
                <strong>눈 깜빡할 사이 사라진 단서.</strong>
                <span>실제로 어떻게 쓰이는지 먼저 보거나, 내 화면에서 바로 시작해 보세요.</span>
                <div className={styles.emptyActions}><button className={styles.primary} onClick={() => setExamplesOpen(true)}><Play size={18} weight="fill" /> 실제 활용 예시</button><button className={styles.demoStart} onClick={() => void startSharing()} aria-label="화면 공유 시작">내 화면에서 사용하기 ↗</button></div>
                <small>웹·게임 개발자라면 어떻게 쓰는지 애니메이션으로 보여드려요</small>
              </div>}
              {stream && <div className={styles.liveFlag}><span /> REC</div>}
              <div hidden={!stream} className={styles.nowLine} style={{ left: `${Math.max(2, bufferPercent)}%` }}><span>NOW</span></div>
              {viewMode === "full" && RESIZE_DIRS.map(({ dir, label }) => (
                <button
                  key={dir}
                  type="button"
                  className={`${styles.resizeHandle} ${styles[`resize${dir.toUpperCase()}`]}`}
                  onPointerDown={(event) => beginStageResize(event, dir)}
                  onKeyDown={(event) => onStageResizeKeyDown(event, dir)}
                  onDoubleClick={(event) => { event.stopPropagation(); resetStageBox(); }}
                  aria-label={`화면 미리보기 ${label} 크기 조절 (더블클릭으로 초기화)`}
                />
              ))}
            </div>
          </div>
          <div className={styles.transport}>
            <span className={styles.timecode}>{timeLabel}</span>
            {stream && bufferBounds
              ? <ReplayScrubber bounds={bufferBounds} spanMs={retention * 60_000} now={clock} at={replayAt} playing={replayPlaying}
                onScrub={scrubReplay} onSeek={seekReplay} onLive={goLive} onTogglePlay={replayPlaying ? pauseReplay : playReplay} />
              : <div className={styles.bufferTrack} aria-label={`버퍼 ${Math.round(bufferPercent)}퍼센트`}><span style={{ width: `${bufferPercent}%` }} /></div>}
            <span>{retention}:00</span>
            {stream ? <button className={styles.iconButton} onClick={stopSharing} aria-label="화면 공유 중지"><Stop size={16} weight="fill" /></button> : <button className={styles.iconButton} onClick={() => void startSharing()} aria-label="화면 공유 시작"><Play size={16} weight="fill" /></button>}
          </div>
        </div>

        <aside className={styles.commandDock}>
          <div className={styles.eyebrowRow}><p className={styles.eyebrow}>{viewMode === "browser" ? "BROWSER REPLAY" : "AI QUICK CHECK"}</p></div>
          {/* The always-on-top export window is the main way to use the app, so it leads the dock. */}
          <button type="button" role="switch" aria-checked={pipOpen} className={styles.pipLauncher} data-on={pipOpen} disabled={!pipSupported}
            onClick={() => { if (pipOpen) closeCapturePip(); else void openCapturePip(false, true); }}>
            <PictureInPicture size={18} weight="bold" />{pipOpen ? "AI 내보내기 창 끄기" : "항상 위 AI 내보내기 창 켜기"}
          </button>
          {(!pipSupported || pipMessage) && <small className={styles.companionError}>{pipMessage || "이 브라우저는 작은 창을 지원하지 않습니다."}</small>}
          {<details className={styles.captureSettings}><summary>기록 설정</summary><label className={styles.field}><span>로컬 버퍼</span><select value={retention} onChange={(event) => changeRetention(Number(event.target.value))}><option value={1}>최근 1분</option><option value={3}>최근 3분</option><option value={5}>최근 5분</option></select></label>
          <label className={styles.field}><span>전송 구간</span><select value={sendSeconds} onChange={(event) => setSendSeconds(Number(event.target.value))}>{[5, 15, 30, 60, 180, 300].filter((value) => value <= retention * 60).map((value) => <option key={value} value={value}>최근 {value < 60 ? `${value}초` : `${value / 60}분`}</option>)}</select></label>
          {viewMode === "full" && <>
          <div className={styles.apiDivider}><span>설치 없이</span><b>화면 바로 확인</b></div>
          <label className={styles.switch}><input type="checkbox" checked={privacyEnabled} disabled={status === "preparing" || status === "analyzing"} onChange={(event) => setPrivacyEnabled(event.target.checked)} /><span /><b><ShieldCheck size={16} /> 전송 전 개인정보 자동 가림</b></label>
          <div className={styles.gestureActions}><button type="button" className={styles.secondary} disabled={!stream || status === "preparing" || status === "analyzing"} onClick={() => { try { setPrivacyImage(snapshot()); setRegionImage(null); } catch { setMessage("가림 영역을 지정할 화면이 없습니다."); } }}>{privacyZone ? "가림 영역 변경" : "가림 영역 지정"}</button>{privacyZone && <button type="button" className={styles.secondary} disabled={status === "preparing" || status === "analyzing"} onClick={() => setPrivacyZone(undefined)}>가림 영역 해제</button>}</div>
          {privacyReport && <small className={styles.companionError}>{privacyReport.scannedFrames}장 로컬 검사 · {privacyReport.maskedRegions ? `${privacyReport.maskedRegions}곳 가린 사본만 전송` : "민감정보 미검출"}</small>}
          {privacyImage && stream && <PrivacyZoneEditor image={privacyImage} value={privacyZone} onCancel={() => setPrivacyImage(null)} onSave={(box) => { setPrivacyZone(box); setPrivacyImage(null); }} />}
          </>}
          </details>}
          <>
            {!stream && <ModeGuide onShowExamples={(mode) => { setExamplesMode(mode); setExamplesOpen(true); }} />}
            {stream && viewMode === "browser" && !pipContainer && exportPanel}
            {stream && viewMode === "browser" && pipContainer && <p>항상 위에 뜬 작은 창에서 모드를 고르고 AI 내보내기를 누르세요.</p>}
            {stream && viewMode === "full" && <><textarea className={styles.workQuestion} aria-label="추가 질문 (선택)" placeholder="질문 없이 버튼만 눌러도 됩니다. 더 궁금한 내용은 여기에 적으세요." value={workQuestion} onChange={event => setWorkQuestion(event.target.value)} maxLength={500} />
            <button className={styles.secondary} onClick={() => void analyzeWithOpenAI("replay", workQuestion.trim() || undefined)} disabled={!stream || status === "preparing" || status === "analyzing"}><ArrowCounterClockwise size={18} /> 최근 {sendSeconds}초 확인하기</button>
            <button className={styles.secondary} onClick={() => void analyzeWithOpenAI("current", workQuestion.trim() || undefined)} disabled={!stream || status === "preparing" || status === "analyzing"}><Camera size={18} /> 지금 화면 확인하기</button>
            <button className={styles.secondary} disabled={!stream || status === "preparing" || status === "analyzing"} onClick={() => { try { setRegionImage(snapshot()); } catch { setMessage("먼저 화면 공유를 시작해 주세요."); } }}><Target size={18} /> 영역 선택해서 확인하기</button>
            <a className={styles.downloadLink} href="/developer-lab" target="_blank" rel="noreferrer">PiP용 개발 작업 탭 열기 ↗</a></>}
          </>
          {regionImage && stream && <RegionCapture image={regionImage} busy={status === "preparing" || status === "analyzing"} onCancel={() => setRegionImage(null)} onSend={async (image, question) => {
            const result = await analyzeWithOpenAI("current", question, [], image);
            if ("text" in result) setRegionImage(null);
          }} />}
          <div className={styles.status} data-tone={status === "error" ? "error" : status === "done" ? "done" : "normal"}>{status === "analyzing" || status === "preparing" ? <CircleNotch className={styles.spin} size={16} /> : status === "error" ? <WarningCircle size={16} /> : status === "done" ? <Check size={16} /> : <span className={styles.statusDot} />}<div><strong>{stateLabel}</strong><span>{message}</span></div></div>
        </aside>
      </section>

      <section ref={analysisSectionRef} hidden={!stream && !frames.length && !analysis} className={styles.replaySection} id="how">
        {stream && <label className={styles.switch}>
          <input type="checkbox" checked={proactiveDetectionEnabled}
                 onChange={(event) => setProactiveDetectionEnabled(event.target.checked)} />
          <span />
          <b>화면 변화 자동 감지 {proactiveDetectionEnabled ? "켜짐" : "꺼짐"}</b>
        </label>}
        {stream && proactiveDetectionEnabled && highlight && <div className={styles.highlightPanel}>
          <div className={styles.timelineHead}><span>방금 뭐가 바뀌었나</span><span>변화 감지 기반</span></div>
          <div className={styles.highlightPair}>
            <figure><img src={highlight.beforeUrl} alt="변화 이전 화면" /><figcaption>이전</figcaption></figure>
            <figure className={styles.highlightAfter}>
              <img src={highlight.afterUrl} alt="변화 이후 화면" />
              <span className={styles.highlightBox} style={{ left: `${highlight.bbox[0] * 100}%`, top: `${highlight.bbox[1] * 100}%`, width: `${(highlight.bbox[2] - highlight.bbox[0]) * 100}%`, height: `${(highlight.bbox[3] - highlight.bbox[1]) * 100}%` }} />
              <figcaption>이후</figcaption>
            </figure>
            {highlightZoomUrl && <figure><img src={highlightZoomUrl} alt="변화 영역 확대" /><figcaption>확대</figcaption></figure>}
          </div>
        </div>}
        {analysis && <div className={styles.resultToolbar}><span>사건 기록 · 공유 화면</span><div><button onClick={() => { setResultFocus(false); window.scrollTo({ top: 0, behavior: "instant" }); }}>질문 바꿔 재분석</button>{!stream && <button onClick={() => void startSharing()}>내 화면에서 사용하기 ↗</button>}</div></div>}
        {(frames.length > 0 || analysis) && <IncidentReview key={analysisRevision} frames={frames} evidence={analysisEvidence} answer={analysis} incident={incident} context={captureContext} sample={false} exploration={exploration} onEvidence={setAnalysisEvidencePreview} />}
        {analysisEvidencePreview !== null && analysisEvidence[analysisEvidencePreview] && <EvidenceTimeMachine evidence={analysisEvidence[analysisEvidencePreview]} onClose={() => setAnalysisEvidencePreview(null)} />}
      </section>

      {viewMode === "full" && <section className={styles.memoryOptIn}><label className={styles.switch}><input type="checkbox" checked={memoryEnabled} onChange={event => setMemoryEnabled(event.target.checked)} /><span /><b>화면 기록을 이 브라우저에 영구 보관 (선택)</b></label><p>켜면 OCR과 화면 이미지가 기기에 저장됩니다. 공유를 중지해도 남습니다.</p>{memoryEnabled && <ScreenMemoryWorkbench recording={Boolean(stream)} onAddToReplay={addMemoryFrameToReplay} />}</section>}

      <DayTimeline active={timelineActive} recorder={labelerStatus} onStart={() => void startTimeline()} onStop={() => setTimelineOn(false)} onShowExample={() => setTimelineExampleOpen(true)} />
      {timelineExampleOpen && <DayTimelineDemo onClose={() => setTimelineExampleOpen(false)} />}


      <section className={styles.pipelineSection} id="pipeline">
        <p className={styles.eyebrow}>HOW CONTEXT EXPORTS</p>
        <h2>다섯 단계로<br />화면 맥락을 전달합니다.</h2>
        <div className={styles.pipelineTrack}>
          <div className={styles.pipelineLine} aria-hidden="true"><span className={styles.pipelineBeam} /></div>
          {BROWSER_PIPELINE_STAGES.map(({ Icon, label, detail }, index) => (
            <div className={styles.pipelineNode} style={{ "--i": index } as React.CSSProperties} key={label}>
              <span className={styles.pipelineIcon}><Icon size={20} weight="bold" /></span>
              <span className={styles.pipelineText}><b>{label}</b><small>{detail}</small></span>
            </div>
          ))}
        </div>

      </section>

      <footer className={styles.footer}><span>방금그거뭐였지</span><span>AI Championship 2026 Prototype</span><span>Built for moments that disappear.</span></footer>
    </main>
  );
}

// The transport bar as a scrubber over the rolling buffer. The track spans
// the retention window starting at the oldest kept segment, so the filled
// part is what has been recorded and its right edge is live.
function ReplayScrubber({ bounds, spanMs, now, at, playing, onScrub, onSeek, onLive, onTogglePlay }: {
  bounds: { start: number; end: number }; spanMs: number; now: number; at: number | null; playing: boolean;
  onScrub: (at: number) => void; onSeek: (at: number, fromLive?: boolean) => void; onLive: () => void; onTogglePlay: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const live = Math.max(bounds.end, Math.min(now, bounds.start + spanMs));
  const fraction = (time: number) => Math.min(1, Math.max(0, (time - bounds.start) / spanMs));
  const timeAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    const time = bounds.start + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * spanMs;
    return Math.min(time, bounds.end);
  };
  // Landing within the last half second means "now": there is no finished
  // segment there yet, so go back to the live picture instead.
  const commit = (time: number) => {
    if (time >= bounds.end - 500) onLive();
    else onSeek(Math.max(bounds.start, time), at === null);
  };
  const current = at ?? live;
  const agoSeconds = Math.round(Math.max(0, live - current) / 1_000);
  return <div ref={track} className={styles.scrubber} role="slider" tabIndex={0} aria-label="버퍼 재생 위치"
    aria-valuemin={0} aria-valuemax={Math.round(spanMs / 1_000)} aria-valuenow={Math.round((current - bounds.start) / 1_000)}
    aria-valuetext={at === null ? "실시간" : `${agoSeconds}초 전`} data-replaying={at !== null}
    onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); dragging.current = true; onScrub(timeAt(event.clientX)); }}
    onPointerMove={(event) => { if (dragging.current) onScrub(timeAt(event.clientX)); }}
    onPointerUp={(event) => { if (!dragging.current) return; dragging.current = false; commit(timeAt(event.clientX)); }}
    onPointerCancel={() => { dragging.current = false; }}
    onKeyDown={(event) => {
      const step = event.shiftKey ? 5_000 : 1_000;
      if (event.key === "ArrowLeft") onSeek(Math.max(bounds.start, current - step), at === null);
      else if (event.key === "ArrowRight") commit(current + step);
      else if (event.key === "Home") onSeek(bounds.start, at === null);
      else if (event.key === "End") onLive();
      else if ((event.key === " " || event.key === "k") && at !== null) onTogglePlay();
      else return;
      event.preventDefault();
    }}>
    <div className={styles.bufferTrack}><span style={{ width: `${fraction(live) * 100}%` }} /></div>
    <span className={styles.scrubHead} data-playing={playing} style={{ left: `${fraction(current) * 100}%` }} />
  </div>;
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
