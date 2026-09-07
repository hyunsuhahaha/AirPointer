"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowClockwise, ArrowCounterClockwise, Camera, CaretDown, Check, CircleNotch, ClipboardText, Desktop, DotsSixVertical, Gear, HandPalm, LockKey, MagnifyingGlass, PaperPlaneTilt, PictureInPicture, Play, ShieldCheck, Sparkle, Stop, Target, WarningCircle, X } from "@phosphor-icons/react";
import { useCompanionGesture } from "@/hooks/use-companion-gesture";
import type { HotkeyBindings } from "@/hooks/use-companion-gesture";
import { useBrowserHandGesture } from "@/hooks/use-browser-gesture";
import type { GestureCommand } from "@/lib/gesture";
import { BrowserReplayBuffer, cropRegion, frameFromVideo, surroundingReplayOffsets, withReplayBookmarks } from "@/lib/replay-buffer";
import type { ChangeHighlight, NormalizedBox, OverviewFrame, ReplayCapsule } from "@/lib/replay-buffer";
import { DEMO_OVERVIEW_OFFSETS, DEMO_SCENARIOS, demoFrameAtOffset, demoFrameState, demoFramesAtOffsets, demoScenario } from "@/lib/demo-replay";
import type { DemoScenarioId } from "@/lib/demo-replay";
import { createPrivacyRedactor } from "@/lib/privacy-redaction";
import type { PrivacyReport } from "@/lib/privacy-redaction";
import { closeScreenOcr, recognizeScreenText } from "@/lib/screen-ocr";
import { listScreenMemoryFrames, memoryFrameFromVideo, saveScreenMemoryFrame, updateScreenMemoryFrame } from "@/lib/screen-memory";
import type { ScreenMemoryFrame } from "@/lib/screen-memory";
import { formatReplayRange } from "@/lib/replay-frame-request";
import type { ReplayExplorationRequest } from "@/lib/replay-frame-request";
import type { PromptTemplate } from "@/lib/prompt-template";
import styles from "./replay-workspace.module.css";
import { BrowserCapturePanel, EvidenceTimeMachine, PrivacyZoneEditor, RegionCapture } from "./browser-capture-panel";
import { ScreenMemoryWorkbench } from "./screen-memory-workbench";
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
      requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
      window: Window | null;
    };
  }
}

type Status = "idle" | "recording" | "preparing" | "analyzing" | "done" | "error";
type Mode = "current" | "replay";
// The PiP capture window's two shapes (see openCapturePip): "buttons" is the
// always-floating minimal trigger pair, "conversation" is the fuller
// Codex-Desktop-like thread view that opens only when there's something to
// show -- Document PiP allows only one window per tab, so these are never
// both open at once; switching between them closes one and opens the other.
type ConversationTurn = { role: "user" | "assistant"; text: string };
type AgentState = "loading" | "idle" | "preparing" | "drafting" | "sending" | "queued" | "done" | "error";
type AgentThread = { id: string; title: string; status: string; cwd: string; updatedAt: number };
type DeliveryTarget = "codex" | "claude";
// Shape AirPointer's companion server returns for Claude Desktop -- see
// App._list_companion_threads in main.py. No cwd/updatedAt (Claude Desktop's
// sidebar doesn't surface those the way Codex's App Server does), but has
// `project` for the same grouped-picker UX as Codex Agent below.
type ClaudeThread = { id: string; title: string; status: string; project: string };
// Shape SessionPicker actually renders -- both AgentThread (Codex, grouped
// by cwd's basename below since Codex's API has no project concept of its
// own) and ClaudeThread (already carries `project`) get mapped into this
// before reaching the picker, so it only has to know one shape. `active` is
// optional since only Codex's status is ever meaningful here (Claude's
// DesktopPasteDelivery threads always report "unknown" -- see
// project_airpointer_claude_code_target memory -- so it's never worth
// mapping ClaudeThread.status into this at all).
type PickerThread = { id: string; title: string; project: string; active?: boolean };
type PendingAgentCapture =
  | { mode: "current"; threadId: string; seconds: number; frames: OverviewFrame[]; region?: boolean }
  | { mode: "replay"; threadId: string; seconds: number; capsule: ReplayCapsule };
type GestureAction = "replay" | "screenshot" | "region";
// Browser-tab-scoped equivalent of HotkeyBindings above -- deliberately a
// separate type/state (see browserHotkeyBindings) rather than reusing
// AirPointer's own combos: this listener only ever sees keys while the tab
// itself has focus (window.keydown, no OS hook), so it needs its own
// defaults that don't collide with AirPointer's global ones or the browser's
// own shortcuts.
type BrowserHotkeyBindings = { screenshot: string; replay: string };
type StageBox = { left: number; top: number; width: number; height: number };
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const PROMPT_PRESETS = [
  "이 상황이 어떻게 된 건지 설명해줘",
  "문제 원인과 해결 방법을 찾아줘",
  "여기서 다음에 무엇을 해야 하는지 알려줘",
];

// Mirrors the real pipeline (screen_buffer.py -> capture_controller.py ->
// clipboard_tracker.py/selection_context.py -> companion_bridge.py), but the
// "active stage" sweep below is a decorative CSS-only loop, not a readout of
// actual phase state -- there's no per-viewer telemetry cheap enough to
// drive this honestly yet.
const BROWSER_PIPELINE_STAGES = [
  { Icon: Camera, label: "화면 캡처", detail: "순환 버퍼에 프레임 기록" },
  { Icon: Sparkle, label: "변화 감지", detail: "바뀐 순간만 골라냄" },
  { Icon: Target, label: "대표 프레임 선택", detail: "핵심 장면으로 압축" },
  { Icon: MagnifyingGlass, label: "AI 재탐색", detail: "놓친 시점과 작은 글씨 재조회" },
  { Icon: Check, label: "근거 연결", detail: "답변과 실제 프레임을 함께 제시" },
];

const NATIVE_PIPELINE_STAGES = [
  { Icon: Camera, label: "화면 캡처", detail: "순환 버퍼에 프레임 기록" },
  { Icon: Sparkle, label: "변화 감지", detail: "바뀐 순간만 골라냄" },
  { Icon: Target, label: "대표 프레임 선택", detail: "핵심 장면으로 압축" },
  { Icon: ClipboardText, label: "컨텍스트 결합", detail: "클립보드 · 선택 영역 · 클릭 이력" },
  { Icon: PaperPlaneTilt, label: "Agent 전달", detail: "Claude Code · Claude Desktop · Codex" },
];

type ScoreChart = {
  points: string;
  thresholdY: number;
  bands: { x: number; width: number }[];
  peaks: { x: number; y: number; score: number }[];
};

// Same hand-drawn curve as before "실시간 연동" existed -- shown whenever the
// checkbox is off, or on but no real data is available yet (see
// liveScoreAvailable/liveScoreChart in ReplayWorkspace).
const DEMO_SCORE_CHART: ScoreChart = {
  points: "0,118 25,120 50,116 75,119 100,122 125,109 150,68 175,34 200,50 225,90 250,117 275,120 300,114 325,119 350,122 375,121 400,112 425,74 450,40 475,58 500,92 525,116 550,119 575,116 600,120",
  thresholdY: 100,
  bands: [{ x: 138, width: 97 }, { x: 413, width: 100 }],
  peaks: [{ x: 175, y: 34, score: 0.81 }, { x: 450, y: 40, score: 0.74 }],
};

const STAGE_MIN_WIDTH = 320;
const STAGE_MIN_HEIGHT = 220;
const REPLAY_FRAME_BUDGET = 18;
const MAX_REPLAY_BOOKMARKS = 6;
const REPLAY_MAX_ROUNDS = 6;
const DEMO_PLAYBACK_MS = 8_000;

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

const AIRPOINTER_PROTOCOL = "airpointer://";
const AIRPOINTER_DOWNLOAD_URL = "/downloads/AirPointer.exe";
// Appended to Codex Agent error messages that mean "this path is unusable
// right now" (no local Codex Desktop/CLI bridge, send failed outright) --
// not to per-field validation messages ("먼저 작업을 선택해 주세요") that
// the user can already fix inline. Points at the always-available fallback
// above so a judge without AirPointer/Codex installed isn't left at a dead
// end.
const AGENT_FALLBACK_HINT = ' 대신 위쪽 "설치 없이 · 화면 바로 확인"을 눌러보세요.';

async function syncMemoryFrameToCompanion(token: string, frame: ScreenMemoryFrame) {
  if (!token || frame.source === "demo") return;
  try {
    await fetch(`/api/companion/memory?token=${encodeURIComponent(token)}&endpoint=frames`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(frame),
    });
  } catch {
    // IndexedDB remains the source of truth in browser-only mode. The next
    // captured frame retries naturally after the native companion reconnects.
  }
}

export function ReplayWorkspace() {
  const screenVideo = useRef<HTMLVideoElement>(null);
  const stageViewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageMoveStart = useRef<{ pointerX: number; pointerY: number; box: StageBox } | null>(null);
  const stageResizeStart = useRef<{ pointerX: number; pointerY: number; box: StageBox; dir: ResizeDir } | null>(null);
  const [stageBox, setStageBox] = useState<StageBox | null>(null);
  const [companionToken, setCompanionToken] = useState("");
  const buffer = useRef(new BrowserReplayBuffer(3 * 60_000));
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [retention, setRetention] = useState(3);
  const [sendSeconds, setSendSeconds] = useState(15);
  const [status, setStatus] = useState<Status>("idle");
  const [frames, setFrames] = useState<OverviewFrame[]>([]);
  const [replayBookmarks, setReplayBookmarks] = useState<OverviewFrame[]>([]);
  const memoryOcrQueue = useRef<Promise<void>>(Promise.resolve());
  const [analysis, setAnalysis] = useState("");
  const [captureContext, setCaptureContext] = useState("");
  const [analysisEvidence, setAnalysisEvidence] = useState<EvidenceItem[]>([]);
  const [analysisEvidencePreview, setAnalysisEvidencePreview] = useState<number | null>(null);
  const [exploration, setExploration] = useState<ExplorationProgress | undefined>();
  const analysisSectionRef = useRef<HTMLElement>(null);
  const [privacyEnabled, setPrivacyEnabled] = useState(true);
  const [privacyZone, setPrivacyZone] = useState<NormalizedBox | undefined>();
  const [privacyReport, setPrivacyReport] = useState<PrivacyReport | undefined>();
  const [privacyImage, setPrivacyImage] = useState<CaptureSnapshot | null>(null);
  const [demoMode, setDemoMode] = useState<"idle" | "playing" | "ready">("idle");
  const [demoElapsed, setDemoElapsed] = useState(0);
  const [demoScenarioId, setDemoScenarioId] = useState<DemoScenarioId>("runtime");
  const [demoQuestion, setDemoQuestion] = useState(demoScenario("runtime").question);
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
  // Which half of the command dock is showing -- "browser" is every trigger
  // that works from this tab alone (OpenAI quick-check, browser gesture/
  // hotkey/PiP), "full" is today's original dock (AirPointer camera panel,
  // native gesture/hotkey start mode, Agent delivery to Codex/Claude -- Codex
  // needs a local Codex Desktop too, so it belongs here, not in "browser").
  // Defaults to "browser" so a judge who never installs anything lands on
  // the mode that's actually all they can use (see the AI Championship
  // submission policy in the conversation this was added for: only a link a
  // judge can open with zero install is accepted).
  const [viewMode, setViewMode] = useState<"browser" | "full">("browser");
  const [message, setMessage] = useState("화면 공유를 시작하면 최근 장면이 이 기기에만 쌓입니다.");
  const [elapsed, setElapsed] = useState(0);
  const [gestureEnabled, setGestureEnabled] = useState(false);
  // Chosen before AirPointer is turned on, not a toggle you flip while it's
  // running -- picks which airpointer:// command changeGestureEnabled sends
  // (see protocol.py's VALID_COMMANDS: "start" vs "start_hotkey").
  const [launchMode, setLaunchMode] = useState<"gesture" | "hotkey">("gesture");
  const [gestureActions, setGestureActions] = useState({ replay: true, screenshot: true, region: true });
  // Native default (airpointer/hotkeys.py's DEFAULT_BINDINGS) -- kept in
  // sync by convention, not by import, since the two run in different
  // languages/runtimes. Whatever's set here is what actually gets registered
  // on the native side: AirPointer always defers to the browser's config
  // once it's connected (see main.py's _resolve_hotkey_bindings).
  const [hotkeyBindings, setHotkeyBindings] = useState<HotkeyBindings>({ screenshot: "ctrl+alt+s", replay: "ctrl+alt+d", region: "ctrl+alt+r" });
  const [agentThreads, setAgentThreads] = useState<AgentThread[]>([]);
  const [agentThreadId, setAgentThreadId] = useState("");
  const [deliveryTarget, setDeliveryTarget] = useState<DeliveryTarget>("codex");
  // Claude Desktop's own picker, loaded through AirPointer's companion
  // server (needs companionToken, i.e. "AirPointer 켜기" already on) rather
  // than a Node-side bridge -- see /api/companion/threads/route.ts and
  // airpointer/desktop_paste.py's sidebar reverse-engineering. "" means
  // "whatever conversation is already open", same as leaving it unset.
  const [claudeThreads, setClaudeThreads] = useState<ClaudeThread[]>([]);
  const [claudeThreadId, setClaudeThreadId] = useState("");
  const [claudeThreadsLoading, setClaudeThreadsLoading] = useState(false);
  const [agentState, setAgentState] = useState<AgentState>("loading");
  const [agentMessage, setAgentMessage] = useState("Codex 작업을 불러오는 중입니다.");
  const [pendingCapture, setPendingCapture] = useState<PendingAgentCapture | null>(null);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [companionMessage, setCompanionMessage] = useState("");
  const [companionLaunchIssue, setCompanionLaunchIssue] = useState<"missing" | "error" | "">("");
  const [bootProgress, setBootProgress] = useState(0);
  const [promptSettingsOpen, setPromptSettingsOpen] = useState(false);
  // Independent of AirPointer's own gesture mode above -- this runs hand
  // tracking entirely in-browser (see useBrowserHandGesture) so it's the one
  // gesture path someone without the native app installed can still use.
  const [browserGestureEnabled, setBrowserGestureEnabled] = useState(false);
  // Same "no install needed" spirit as browserGestureEnabled, but keyboard
  // instead of the webcam -- only works while this tab has focus (see the
  // window.keydown effect below), unlike AirPointer's OS-level global hotkeys.
  const [browserHotkeyEnabled, setBrowserHotkeyEnabled] = useState(false);
  const [browserHotkeyBindings, setBrowserHotkeyBindings] = useState<BrowserHotkeyBindings>({ screenshot: "alt+shift+s", replay: "alt+shift+d" });
  // Third no-install trigger: an always-on-top floating window with its own
  // two buttons. Unlike the keyboard/webcam triggers above, this one keeps
  // working even while some other app has focus -- see openCapturePip.
  const pipWindowRef = useRef<Window | null>(null);
  const [pipSupported, setPipSupported] = useState(false);
  const [pipOpen, setPipOpen] = useState(false);
  const [pipMessage, setPipMessage] = useState("");
  const [pipContainer, setPipContainer] = useState<HTMLElement | null>(null);
  const [regionImage, setRegionImage] = useState<CaptureSnapshot | null>(null);
  const analysisInFlight = useRef(false);
  const replayCapsuleRef = useRef<ReplayCapsule | null>(null);
  // Deliberately deferred to an effect (not a useState lazy initializer)
  // so the first client render matches the SSR pass (window is undefined
  // there too) before this flips post-mount -- an inline/lazy-initializer
  // check would read `window` during the client's very first render and
  // mismatch the server-rendered markup instead.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPipSupported(typeof window !== "undefined" && "documentPictureInPicture" in window); }, []);
  const [promptTemplate, setPromptTemplate] = useState<PromptTemplate | null>(null);
  const [promptSettingsState, setPromptSettingsState] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [promptSettingsMessage, setPromptSettingsMessage] = useState("");
  // User intent, not availability -- stays checked across a connection drop
  // so the chart just falls back to the demo curve with an explanation
  // rather than silently unchecking itself (see liveScoreAvailable below).
  const [liveScoreEnabled, setLiveScoreEnabled] = useState(false);

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
    stream?.getTracks().forEach((track) => track.stop());
    buffer.current.stop();
    setStream(null);
    setHighlight(null); setHighlightZoomUrl("");
    setElapsed(0);
    setStatus("idle");
    setMessage("버퍼를 비웠습니다. 화면 데이터는 남아 있지 않습니다.");
    setRegionImage(null);
    setReplayBookmarks([]);
  }, [stream]);

  const stopDemo = useCallback(() => {
    setDemoMode("idle"); setDemoElapsed(0); setFrames([]); setAnalysis(""); setCaptureContext("");
    setAnalysisEvidence([]); setAnalysisEvidencePreview(null); setExploration(undefined); setPrivacyReport(undefined);
    setStatus("idle"); setMessage("화면 공유를 시작하면 최근 장면이 이 기기에만 쌓입니다.");
  }, []);

  useEffect(() => {
    if (demoMode !== "playing") return;
    const startedAt = performance.now();
    let animationFrame = 0;
    const tick = (now: number) => {
      const next = Math.min(DEMO_PLAYBACK_MS, now - startedAt);
      setDemoElapsed(next);
      if (next >= DEMO_PLAYBACK_MS) {
        setDemoMode("ready"); setStatus("recording"); setMessage("샘플 리플레이가 준비됐습니다. 방금 사라진 오류를 AI에게 물어보세요."); return;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [demoMode]);

  const startSharing = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setStatus("error"); setMessage("이 브라우저는 화면 공유를 지원하지 않습니다. 최신 Chrome 또는 Edge를 사용해 주세요."); return;
    }
    try {
      setDemoMode("idle"); setDemoElapsed(0);
      const nextStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 24 } }, audio: false });
      if (!screenVideo.current) return;
      setRegionImage(null);
      setHighlight(null); setHighlightZoomUrl("");
      screenVideo.current.srcObject = nextStream;
      await screenVideo.current.play();
      buffer.current.setRetention(retention);
      buffer.current.start(nextStream);
      nextStream.getVideoTracks()[0].addEventListener("ended", () => {
        buffer.current.stop(); setStream(null); setElapsed(0); setStatus("idle"); setMessage("화면 공유가 종료되어 버퍼를 비웠습니다.");
        setHighlight(null); setHighlightZoomUrl(""); setRegionImage(null);
        setReplayBookmarks([]);
      }, { once: true });
      setStream(nextStream);
      setReplayBookmarks([]);
      setFrames([]); setAnalysis(""); setAnalysisEvidence([]); setAnalysisEvidencePreview(null); setExploration(undefined); setStatus("recording"); setMessage("기록 중입니다. 트리거 전에는 어떤 화면도 서버로 보내지 않습니다.");
    } catch (reason) {
      const denied = reason instanceof DOMException && reason.name === "NotAllowedError";
      setStatus("error"); setMessage(denied ? "화면 공유가 취소되었습니다. 준비되면 다시 시작해 주세요." : "화면 공유를 시작하지 못했습니다.");
    }
  }, [retention]);

  const captureFrames = useCallback(async (mode: Mode) => {
    if (demoMode !== "idle") {
      replayCapsuleRef.current = null;
      const demoFrames = mode === "current" ? [demoFrameAtOffset(demoScenarioId, -0.05)] : demoFramesAtOffsets(demoScenarioId, DEMO_OVERVIEW_OFFSETS, "replay-frame");
      setFrames(demoFrames);
      return demoFrames;
    }
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
  }, [demoMode, demoScenarioId, replayBookmarks, sendSeconds, stream]);

  // All browser triggers share one request guard, including the PiP portal.
  const analyzeWithOpenAI = useCallback(async (mode: AnalysisMode, question?: string, history?: ConversationTurn[], image?: CaptureSnapshot, model?: AnalysisModelId): Promise<{ text: string; captureContext?: string; evidence?: EvidenceItem[]; exploration?: ExplorationProgress; privacy?: PrivacyReport } | { error: string }> => {
    if (mode !== "text" && !image && demoMode === "idle" && (!stream || !screenVideo.current)) {
      const error = "먼저 화면 공유를 시작해 주세요.";
      setStatus("error"); setMessage(error);
      return { error };
    }
    if (analysisInFlight.current) return { error: "이전 분석이 끝난 뒤 다시 보내주세요." };
    analysisInFlight.current = true;
    let privacyRedactor: Awaited<ReturnType<typeof createPrivacyRedactor>> | undefined;
    const redactedCache = new Map<string, { url: string; regions: { category: string }[] }>();
    let latestPrivacy: PrivacyReport | undefined;
    const analysisStartedAt = performance.now();
    const timing: AnalysisTiming = { totalMs: 0, captureMs: 0, privacyMs: 0, apiMs: 0, replayMs: 0, evidenceMs: 0 };
    setStatus("preparing"); setAnalysis(""); setCaptureContext(""); setAnalysisEvidence([]); setAnalysisEvidencePreview(null); setExploration(undefined); setPrivacyReport(undefined);
    try {
      const captureStartedAt = performance.now();
      const nextFrames: OverviewFrame[] = mode === "text" ? [] : image ? [{ url: image.url, atSeconds: 0, capturedAt: image.capturedAt }] : await captureFrames(mode);
      timing.captureMs += performance.now() - captureStartedAt;
      if (image) setFrames(nextFrames);
      const settings = stream?.getVideoTracks()[0]?.getSettings();
      const surface = image?.surface ?? settings?.displaySurface;
      const metadata: CaptureMetadata | undefined = mode === "text" ? undefined : {
        capturedAt: Date.now(),
        surface: demoMode !== "idle" ? "browser" : surface === "browser" || surface === "window" || surface === "monitor" ? surface : "unknown",
        width: image?.width ?? (demoMode !== "idle" ? 1440 : screenVideo.current!.videoWidth),
        height: image?.height ?? (demoMode !== "idle" ? 900 : screenVideo.current!.videoHeight),
        requestedSeconds: mode === "replay" ? sendSeconds : 0,
        selection: image?.selection,
        images: nextFrames.map(frame => ({
          kind: image ? "selection" : mode === "current" ? "screen" : frame.kind ?? "change-crop",
          offsetsSeconds: image || mode === "current" ? [0] : frame.sampleOffsetsSeconds ?? [],
        })),
      };
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
        if (mode !== "text") setFrames(requestFrames.map((frame, index) => ({ ...frame, url: transmittedFrames[index] })));
        const apiStartedAt = performance.now();
        const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, model, frames: transmittedFrames, question, history, metadata: requestMetadata, exploration: replayExploration }) });
        timing.apiMs += performance.now() - apiStartedAt;
        const data = await response.json() as { analysis?: string; error?: string; captureContext?: string; explorationRequests?: ReplayExplorationRequest[]; evidence?: { frameIndex: number; claim: string }[] };
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
            { label: "코드 영역 확대", detail: `${analyzedFrames.indexOf(candidate) + 1}번 프레임의 작은 글씨를 원본 해상도로 읽는 중`, added: 0, status: "working" },
          ] };
        } else {
          progress = { ...progress, round, steps: [...progress.steps, { label: `${formatReplayRange(frameOffsets)} 구간 재탐색`, detail: "로컬 영상에서 중간 프레임을 꺼내는 중", added: 0, status: "working" }] };
        }
        setExploration(progress);
        for (const request of data.explorationRequests) {
          if (additions.length >= remaining) break;
          if (request.type === "frames") {
            const offsets = request.offsetsSeconds.filter((offset) => {
              const signature = `frame:${offset.toFixed(3)}`;
              if (requestSignatures.has(signature) || analyzedFrames.some((frame) => Math.abs(frame.atSeconds - Math.abs(offset)) < 0.04)) return false;
              requestSignatures.add(signature); return true;
            }).slice(0, remaining - additions.length);
            if (!offsets.length) continue;
            setMessage(`AI가 ${offsets.map((offset) => `${offset}초`).join(", ")} 구간을 더 촘촘히 탐색하고 있습니다.`);
            const found = demoMode !== "idle" ? demoFramesAtOffsets(demoScenarioId, offsets) : replayCapsuleRef.current ? await buffer.current.framesAtOffsets(replayCapsuleRef.current, offsets) : [];
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
      if (!data.analysis) throw new Error(data.error || "분석 결과를 받지 못했습니다.");
      if (progress) {
        progress = { ...progress, steps: [...progress.steps, { label: "근거 확보 중", detail: "답변에 연결할 전후 프레임을 로컬에서 준비하는 중", added: 0, status: "working" }] };
        setExploration(progress);
      }
      const evidenceStartedAt = performance.now();
      const evidence = await Promise.all((data.evidence ?? []).flatMap(({ frameIndex, claim }) => analyzedFrames[frameIndex] ? [{ claim, frame: analyzedFrames[frameIndex] }] : []).map(async ({ claim, frame }) => {
        const offsets = surroundingReplayOffsets(frame.atSeconds, sendSeconds);
        const timeline = mode !== "replay" ? [frame] : demoMode !== "idle" ? demoFramesAtOffsets(demoScenarioId, offsets) : replayCapsuleRef.current ? await buffer.current.framesAtOffsets(replayCapsuleRef.current, offsets) : [frame];
        return { claim, frame, timeline: timeline.length ? timeline : [frame], focusBox: frame.focusBox } satisfies EvidenceItem;
      }));
      timing.evidenceMs += performance.now() - evidenceStartedAt;
      timing.totalMs = performance.now() - analysisStartedAt;
      const completedProgress = progress ? { ...progress, active: false, usedFrames: analyzedFrames.length, timing, steps: progress.steps.map((step, index) => index === progress!.steps.length - 1 ? { ...step, label: "근거 확보 완료", detail: `답변에 연결할 화면 근거 ${evidence.length}개 확인`, status: "done" as const } : step) } : undefined;
      if (completedProgress) setExploration(completedProgress);
      setAnalysisEvidence(evidence);
      const privacyReceipt = latestPrivacy ? `\n\n개인정보 보호\n브라우저 로컬 검사: ${latestPrivacy.scannedFrames}장 · 가림: ${latestPrivacy.maskedRegions}곳${latestPrivacy.categories.length ? ` (${latestPrivacy.categories.join(", ")})` : ""}\n서버에는 가림 처리된 사본만 전송했습니다.` : "";
      const nextCaptureContext = `${data.captureContext ?? ""}${privacyReceipt}`.trim();
      setCaptureContext(nextCaptureContext); setAnalysis(data.analysis); setStatus("done"); setMessage("분석이 끝났습니다. 원본은 로컬에만 남고 전송 프레임은 서버에 저장하지 않습니다.");
      return { text: data.analysis, captureContext: nextCaptureContext, evidence, exploration: completedProgress, privacy: latestPrivacy };
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : "전송에 실패했습니다.";
      setStatus("error"); setMessage(error);
      return { error };
    } finally {
      await privacyRedactor?.close();
      analysisInFlight.current = false;
    }
  }, [captureFrames, demoMode, demoScenarioId, privacyEnabled, privacyZone, sendSeconds, stream]);

  const snapshot = useCallback(() => {
    if (demoMode !== "idle") {
      const frame = demoFrameAtOffset(demoScenarioId, -0.05);
      return { url: frame.url, capturedAt: frame.capturedAt ?? Date.now(), width: 1440, height: 900, surface: "browser" } satisfies CaptureSnapshot;
    }
    if (!stream || !screenVideo.current) throw new Error("먼저 화면 공유를 시작해 주세요.");
    const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
    return { url: frameFromVideo(screenVideo.current), capturedAt: Date.now(), width: screenVideo.current.videoWidth, height: screenVideo.current.videoHeight,
      surface: surface === "browser" || surface === "window" || surface === "monitor" ? surface : "unknown" } satisfies CaptureSnapshot;
  }, [demoMode, demoScenarioId, stream]);

  const addReplayBookmark = useCallback(() => {
    try {
      const marked = snapshot();
      const frame = { url: marked.url, capturedAt: marked.capturedAt, atSeconds: 0, sampleOffsetsSeconds: [0], kind: "bookmarked-frame" } satisfies OverviewFrame;
      setReplayBookmarks((current) => [...current, frame].slice(-MAX_REPLAY_BOOKMARKS));
      void saveScreenMemoryFrame({ capturedAt: marked.capturedAt, imageUrl: marked.url, text: "", source: "bookmark", surface: marked.surface, width: marked.width, height: marked.height, bookmarked: true, note: "", tags: [] }).then((saved) => {
        void syncMemoryFrameToCompanion(companionToken, saved);
        memoryOcrQueue.current = memoryOcrQueue.current.then(async () => {
          const text = await recognizeScreenText(saved.imageUrl);
          if (text) {
            const updated = await updateScreenMemoryFrame(saved.id, { text });
            if (updated) await syncMemoryFrameToCompanion(companionToken, updated);
          }
        });
      });
      setMessage("현재 화면을 북마크했습니다. 다음 리플레이에서 대표 6장 뒤에 추가됩니다.");
    } catch {
      setMessage("북마크할 화면이 없습니다. 먼저 화면 공유를 시작해 주세요.");
    }
  }, [companionToken, snapshot]);

  const addMemoryFrameToReplay = useCallback((memoryFrame: ScreenMemoryFrame) => {
    const frame = { url: memoryFrame.imageUrl, capturedAt: memoryFrame.capturedAt, atSeconds: 0, sampleOffsetsSeconds: [0], kind: "bookmarked-frame" } satisfies OverviewFrame;
    setReplayBookmarks((current) => [...current.filter((item) => item.url !== frame.url), frame].slice(-MAX_REPLAY_BOOKMARKS));
  }, []);

  const openCapturePip = useCallback(async (expanded = false) => {
    if (!window.documentPictureInPicture) return;
    setPipMessage("");
    try {
      const pipWindow = await window.documentPictureInPicture.requestWindow({ width: expanded ? 380 : 320, height: expanded ? 560 : 120 });
      pipWindowRef.current = pipWindow;
      pipWindow.document.title = "캡처";
      pipWindow.document.documentElement.lang = "ko";
      pipWindow.document.documentElement.className = document.documentElement.className;
      pipWindow.document.body.style.cssText = "margin:0;background:#111210;color-scheme:dark";
      // The portal shares React state, but PiP has its own document. Carry
      // the app's compiled CSS and font definitions across without relaxing CSP.
      for (const sheet of document.styleSheets) {
        const style = pipWindow.document.createElement("style");
        style.nonce = (sheet.ownerNode as HTMLElement | null)?.nonce ?? "";
        style.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
        pipWindow.document.head.append(style);
      }
      if (pipWindow.closed) return;
      setPipContainer(pipWindow.document.body);
      setPipOpen(true);
      pipWindow.addEventListener("pagehide", () => {
        if (pipWindowRef.current !== pipWindow) return;
        pipWindowRef.current = null;
        setPipContainer(null);
        setPipOpen(false);
      }, { once: true });
    } catch (reason) {
      pipWindowRef.current?.close();
      pipWindowRef.current = null;
      setPipContainer(null);
      setPipMessage(reason instanceof Error ? reason.message : "떠 있는 캡처 창을 열지 못했습니다.");
      setPipOpen(false);
    }
  }, []);

  const startDemo = useCallback(async () => {
    setDemoMode("playing"); setDemoElapsed(0); setDemoQuestion(demoScenario(demoScenarioId).question);
    setSendSeconds(60); setRetention(1); setFrames([]); setAnalysis(""); setCaptureContext("");
    setAnalysisEvidence([]); setAnalysisEvidencePreview(null); setExploration(undefined); setPrivacyReport(undefined);
    setStatus("recording"); setMessage("60초 작업 화면을 압축 재생 중입니다. 0.5초짜리 오류를 놓치지 마세요.");
    const currentPip = pipWindowRef.current;
    if (currentPip && !currentPip.closed) {
      try { currentPip.resizeTo(380, 560); } catch { /* The browser owns PiP window placement. */ }
    } else {
      await openCapturePip(true);
    }
  }, [demoScenarioId, openCapturePip]);

  const closeCapturePip = useCallback(() => {
    pipWindowRef.current?.close();
    pipWindowRef.current = null;
    setPipContainer(null);
    setPipOpen(false);
  }, []);

  useEffect(() => () => { pipWindowRef.current?.close(); }, []);

  const handleBrowserGestureCommand = useCallback((command: GestureCommand) => {
    if (command === "send-replay") void analyzeWithOpenAI("replay");
  }, [analyzeWithOpenAI]);
  const { pose: browserGesturePose, progress: browserGestureProgress, preview: browserGesturePreview, ready: browserGestureReady, error: browserGestureError } = useBrowserHandGesture({ enabled: browserGestureEnabled, onCommand: handleBrowserGestureCommand });

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
      setAgentMessage((reason instanceof Error ? reason.message : "Codex Agent 연결에 실패했습니다.") + AGENT_FALLBACK_HINT);
    }
  }, []);

  const handleAgentThreadChange = useCallback((id: string) => {
    setAgentThreadId(id);
    window.localStorage.setItem("airpointer-agent-thread", id);
    setAgentState("idle");
    setAgentMessage(id ? "제스처 전송 준비가 끝났습니다." : "전송할 Codex 작업을 선택해 주세요.");
  }, []);

  // Codex's AgentThread has no `project` -- grouped by its `cwd`'s
  // basename instead (see pathBasename/groupPickerThreads) so SessionPicker
  // only ever deals with one thread shape regardless of source.
  const codexPickerThreads = useMemo<PickerThread[]>(
    () => agentThreads.map((thread) => ({
      id: thread.id, title: thread.title, project: pathBasename(thread.cwd), active: thread.status === "active",
    })),
    [agentThreads],
  );

  const openPromptSettings = useCallback(async () => {
    setPromptSettingsOpen(true);
    setPromptSettingsState("loading");
    setPromptSettingsMessage("");
    try {
      const response = await fetch("/api/prompt-settings", { cache: "no-store" });
      const data = await response.json() as { template?: PromptTemplate; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error || "설정을 불러오지 못했습니다.");
      setPromptTemplate(data.template);
      setPromptSettingsState("idle");
    } catch (reason) {
      setPromptSettingsState("error");
      setPromptSettingsMessage(reason instanceof Error ? reason.message : "설정을 불러오지 못했습니다.");
    }
  }, []);

  const savePromptSettings = useCallback(async () => {
    if (!promptTemplate) return;
    setPromptSettingsState("saving");
    setPromptSettingsMessage("");
    try {
      const response = await fetch("/api/prompt-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(promptTemplate) });
      const data = await response.json() as { saved?: boolean; error?: string };
      if (!response.ok || !data.saved) throw new Error(data.error || "설정을 저장하지 못했습니다.");
      setPromptSettingsState("idle");
      setPromptSettingsMessage("저장했습니다. 다음 전송부터 적용됩니다.");
    } catch (reason) {
      setPromptSettingsState("error");
      setPromptSettingsMessage(reason instanceof Error ? reason.message : "설정을 저장하지 못했습니다.");
    }
  }, [promptTemplate]);

  const resetPromptSettings = useCallback(async () => {
    setPromptSettingsState("saving");
    setPromptSettingsMessage("");
    try {
      const response = await fetch("/api/prompt-settings", { method: "DELETE" });
      const data = await response.json() as { template?: PromptTemplate; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error || "초기화하지 못했습니다.");
      setPromptTemplate(data.template);
      setPromptSettingsState("idle");
      setPromptSettingsMessage("기본값으로 되돌렸습니다.");
    } catch (reason) {
      setPromptSettingsState("error");
      setPromptSettingsMessage(reason instanceof Error ? reason.message : "초기화하지 못했습니다.");
    }
  }, []);

  const postToAgent = useCallback(async (payload: { threadId: string; mode: Mode; kind: "screenshot" | "region"; seconds: number; frames: string[]; userPrompt: string }) => {
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

  // Claude Desktop has no App-Tools pipe or SDK like Codex does (see
  // codex-desktop-bridge.ts / codex-app-server.ts), so this instead reaches
  // it through AirPointer's own delivery -- the same UI automation the
  // native app already uses for its own captures (see
  // airpointer/desktop_paste.py, App._deliver_companion_capture). Requires
  // AirPointer to be running and paired (companionToken set, i.e. the
  // "AirPointer 켜기" switch above is on) -- there's no App-Tools-pipe-style
  // fallback for this path.
  const postToCompanion = useCallback(async (frames: string[], kind: "screenshot" | "region" | "replay", prompt: string) => {
    if (!companionToken) throw new Error("Claude Code로 보내려면 먼저 AirPointer를 켜주세요.");
    const response = await fetch(`/api/companion/send?token=${encodeURIComponent(companionToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "claude", threadId: claudeThreadId, prompt, kind, frames }),
    });
    const data = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok) throw new Error(data.error || "Claude Desktop 전송에 실패했습니다.");
    return data;
  }, [claudeThreadId, companionToken]);

  const loadClaudeThreads = useCallback(async () => {
    if (!companionToken) { setClaudeThreads([]); setClaudeThreadId(""); return; }
    setClaudeThreadsLoading(true);
    try {
      const response = await fetch(`/api/companion/threads?token=${encodeURIComponent(companionToken)}&target=claude`, { cache: "no-store" });
      const data = await response.json() as { threads?: ClaudeThread[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Claude Desktop 세션을 불러오지 못했습니다.");
      const nextThreads = data.threads || [];
      setClaudeThreads(nextThreads);
      setClaudeThreadId((current) => (nextThreads.some((thread) => thread.id === current) ? current : ""));
    } catch (reason) {
      setClaudeThreads([]);
      setAgentMessage(reason instanceof Error ? reason.message : "Claude Desktop 세션을 불러오지 못했습니다.");
    } finally {
      setClaudeThreadsLoading(false);
    }
  }, [companionToken]);

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
    if (deliveryTarget === "codex" && !agentThreadId) { setAgentState("error"); setAgentMessage("먼저 전송할 Codex 작업을 선택해 주세요."); return; }
    if (deliveryTarget === "claude" && !companionToken) { setAgentState("error"); setAgentMessage("Claude Code로 보내려면 먼저 AirPointer를 켜주세요."); return; }
    if (!stream || !screenVideo.current) { setAgentState("error"); setAgentMessage("먼저 화면 공유를 시작해 주세요."); return; }
    setAgentState("preparing");
    try {
      setAgentMessage(`${mode === "current" ? "현재 화면" : `최근 ${sendSeconds}초`} 맥락을 고정하고 있습니다.`);
      if (mode === "replay") {
        const baseCapsule = await buffer.current.recentCapsule(sendSeconds, 6);
        const capsule = { ...baseCapsule, overviewFrames: withReplayBookmarks(baseCapsule.overviewFrames, replayBookmarks, baseCapsule.triggeredAt, MAX_REPLAY_BOOKMARKS) };
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
  }, [agentThreadId, captureFrames, companionToken, deliveryTarget, replayBookmarks, sendSeconds, stream]);

  const cancelPendingCapture = useCallback(() => {
    if (agentState === "sending" || agentState === "queued") return;
    setPendingCapture(null); setAgentPrompt(""); setAgentState("idle");
    setAgentMessage("전송을 취소했습니다. 고정한 맥락은 Agent로 보내지지 않았습니다.");
  }, [agentState]);

  const submitPendingCapture = useCallback(async () => {
    const prompt = agentPrompt.trim();
    if (!pendingCapture || !prompt || agentState === "sending" || agentState === "queued") return;
    setAgentState("sending");
    setAgentMessage(deliveryTarget === "claude"
      ? "질문과 고정한 화면 맥락을 Claude Code에 전송하고 있습니다."
      : "질문과 고정한 화면 맥락을 Codex Agent에 전송하고 있습니다.");
    try {
      let data: { turnId?: string; ok?: boolean };
      if (deliveryTarget === "claude") {
        // No Replay Capsule (video segments + on-demand frame query) for
        // Claude yet -- just the overview frames already shown in the
        // timeline, same as what a "current screen" send uses.
        const frames = pendingCapture.mode === "replay" ? pendingCapture.capsule.overviewFrames : pendingCapture.frames;
        const kind = pendingCapture.mode === "replay" ? "replay" : pendingCapture.region ? "region" : "screenshot";
        data = await postToCompanion(frames.map((frame) => frame.url), kind, prompt);
      } else if (pendingCapture.mode === "replay") {
        const { capsule } = pendingCapture;
        const form = new FormData();
        form.set("metadata", JSON.stringify({ threadId: pendingCapture.threadId, mode: pendingCapture.mode, seconds: pendingCapture.seconds, userPrompt: prompt, startedAt: capsule.startedAt, triggeredAt: capsule.triggeredAt, segments: capsule.segments.map(({ startedAt, durationMs, blob }) => ({ startedAt, durationMs, mimeType: blob.type })) }));
        capsule.overviewFrames.forEach((frame, index) => form.append("overview", dataUrlToBlob(frame.url), `overview-${String(index + 1).padStart(2, "0")}.jpg`));
        capsule.segments.forEach((segment, index) => form.append("segment", segment.blob, `segment-${String(index + 1).padStart(3, "0")}.webm`));
        data = await postCapsuleToAgent(form);
      } else {
        data = await postToAgent({ threadId: pendingCapture.threadId, mode: pendingCapture.mode, kind: pendingCapture.region ? "region" : "screenshot", seconds: pendingCapture.seconds, frames: pendingCapture.frames.map((frame) => frame.url), userPrompt: prompt });
      }
      const label = pendingCapture.mode === "replay" ? `최근 ${pendingCapture.seconds}초 Replay Capsule` : pendingCapture.region ? "선택 영역" : "현재 화면";
      setPendingCapture(null); setAgentPrompt(""); setAgentState("done");
      setAgentMessage(deliveryTarget === "claude"
        ? `${label}과 질문을 Claude Code에 보냈습니다.`
        : `${label}과 질문을 Codex 작업에 보냈습니다. (${data.turnId})`);
    } catch (reason) {
      setAgentState("error");
      const base = reason instanceof Error ? reason.message
        : deliveryTarget === "claude" ? "Claude Desktop 전송에 실패했습니다." : "Codex Agent 전송에 실패했습니다.";
      // Claude Desktop failures here mean AirPointer is already running (its
      // token gates the whole "claude" path -- see prepareAgentCapture above)
      // and something else went wrong, so the fallback hint would be noise;
      // Codex failures can mean no local bridge exists at all.
      setAgentMessage(deliveryTarget === "codex" ? base + AGENT_FALLBACK_HINT : base);
    }
  }, [agentPrompt, agentState, deliveryTarget, pendingCapture, postCapsuleToAgent, postToAgent, postToCompanion]);

  const changeGestureEnabled = useCallback((enabled: boolean) => {
    // External protocols must be opened while the trusted click is still active.
    // Calling this later from the asynchronous camera-ready callback is blocked by Chrome.
    const token = enabled ? window.crypto.randomUUID() : companionToken;
    setCompanionLaunchIssue("");
    const outcome = launchAirPointer(enabled ? (launchMode === "hotkey" ? "start_hotkey" : "start") : "quit", token);
    if (enabled && outcome) void outcome.then((issue) => setCompanionLaunchIssue(issue || ""));
    setCompanionToken(enabled ? token : "");
    setGestureEnabled(enabled);
    setCompanionMessage(enabled ? "AirPointer를 시작하고 있습니다." : "");
  }, [companionToken, launchMode]);

  const setGestureAction = useCallback((action: GestureAction, enabled: boolean) => {
    setGestureActions((current) => ({ ...current, [action]: enabled }));
  }, []);

  const setHotkeyBinding = useCallback((action: GestureAction, combo: string) => {
    setHotkeyBindings((current) => ({ ...current, [action]: combo }));
  }, []);

  const { pose, progress: gestureProgress, preview: companionPreview, sentFrames: companionSentFrames, selection: gestureSelection, error: gestureError, ready: companionReady, connected: companionConnected, activeMode, scoreHistory: liveScoreHistory, scoreThreshold: liveScoreThreshold } = useCompanionGesture({ enabled: gestureEnabled, token: companionToken, agentThreadId, gestures: gestureActions, hotkeys: hotkeyBindings, deliveryTarget });
  const hotkeyMode = activeMode ? activeMode === "hotkey" : launchMode === "hotkey";

  // AirPointer has to actually be running for scoreHistory to mean anything
  // -- companion_bridge.py only ever gets real values pushed into it from
  // App._redraw() while the native capture loop is alive (see main.py).
  const liveScoreAvailable = gestureEnabled && companionReady;
  const liveScoreChart = useMemo<ScoreChart | null>(() => {
    if (liveScoreHistory.length < 2) return null;
    const scores = liveScoreHistory.map(([, score]) => score);
    // Real global-diff scores run far below 1.0 in practice (see the
    // mem_probe.py measurement thread) -- scale to whatever's actually
    // showing up so the line isn't squashed flat against the bottom.
    const maxScore = Math.max(liveScoreThreshold * 1.4, ...scores, 0.001);
    const minT = liveScoreHistory[0][0];
    const maxT = liveScoreHistory[liveScoreHistory.length - 1][0];
    const span = Math.max(maxT - minT, 0.001);
    const toX = (t: number) => ((t - minT) / span) * 600;
    const toY = (score: number) => 135 - (score / maxScore) * 125;
    const points = liveScoreHistory.map(([t, score]) => `${toX(t).toFixed(1)},${toY(score).toFixed(1)}`).join(" ");

    // One pass: a run of consecutive at-or-above-threshold samples becomes
    // one shaded band plus one peak marker at that run's highest score --
    // mirrors _ChangeTracker merging consecutive above-threshold frames into
    // one ChangeEvent, just without the quiet-frame hysteresis (this only
    // has the global score to work with, not the tile grid _ChangeTracker
    // also checks -- see the legend's "전역 기준만" note).
    const bands: { x: number; width: number }[] = [];
    const peaks: { x: number; y: number; score: number }[] = [];
    let runStartT: number | null = null;
    let runBestT = 0;
    let runBestScore = 0;
    const closeRun = (endT: number) => {
      if (runStartT === null) return;
      bands.push({ x: toX(runStartT), width: Math.max(4, toX(endT) - toX(runStartT)) });
      peaks.push({ x: toX(runBestT), y: toY(runBestScore), score: runBestScore });
      runStartT = null;
    };
    liveScoreHistory.forEach(([t, score], index) => {
      const above = score >= liveScoreThreshold;
      if (above) {
        if (runStartT === null) { runStartT = t; runBestT = t; runBestScore = score; }
        else if (score > runBestScore) { runBestT = t; runBestScore = score; }
        if (index === liveScoreHistory.length - 1) closeRun(t);
      } else {
        closeRun(liveScoreHistory[index - 1]?.[0] ?? t);
      }
    });

    return { points, thresholdY: toY(liveScoreThreshold), bands, peaks };
  }, [liveScoreHistory, liveScoreThreshold]);
  const showLiveScore = liveScoreEnabled && liveScoreAvailable && liveScoreChart !== null;
  const scoreChart = showLiveScore ? liveScoreChart! : DEMO_SCORE_CHART;

  // Mirrors a gesture/hotkey-triggered capture into the same "LOCAL RING
  // BUFFER" grid below that otherwise only ever shows this page's own
  // screen-share captures (see setFrames elsewhere in this file) -- a
  // native capture never reached the browser at all before this, since it
  // goes straight to Codex/Claude Desktop via desktop_paste.py.
  useEffect(() => {
    // atSeconds now comes from the native side for real (see
    // App._publish_sent_frames, which reads screen_buffer.py's
    // export_recent() sidecar) -- 0 for a screenshot/region send is
    // genuinely "just now", not a placeholder.
    // Mirror an external companion event into the shared capture preview.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (companionSentFrames.length) setFrames(companionSentFrames);
  }, [companionSentFrames]);

  // Reset the boot-progress estimate the moment the switch turns off, during
  // render rather than as a setState call inside the effect below.
  const [trackedGestureEnabled, setTrackedGestureEnabled] = useState(gestureEnabled);
  if (gestureEnabled !== trackedGestureEnabled) {
    setTrackedGestureEnabled(gestureEnabled);
    if (!gestureEnabled) setBootProgress(0);
  }

  useEffect(() => {
    // No real progress signal exists for the exe-launch portion (PyInstaller
    // onefile extraction happens before the companion's HTTP server can even
    // answer), so that part is an elapsed-time estimate -- eases toward 96%
    // and never claims 100% on its own. Camera warm-up after that point does
    // have a real signal (companionReady, which folds in state.cameraReady),
    // so 100% is reserved for that actually being true, not just guessed.
    if (!gestureEnabled || companionReady) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setBootProgress(Math.round(96 * (1 - Math.exp(-elapsed / 3200))));
    }, 100);
    return () => window.clearInterval(timer);
  }, [gestureEnabled, companionReady]);

  useEffect(() => {
    if (!stream) return;
    const timer = window.setInterval(() => setElapsed(buffer.current.status().durationMs), 1_000);
    return () => window.clearInterval(timer);
  }, [stream]);
  useEffect(() => {
    // Masked at render (`stream &&` on the highlight card below), not reset
    // here, so this effect never needs a setState-in-effect just to zero
    // things out on stop -- same pattern as useCompanionGesture/
    // useBrowserHandGesture. Disabling the toggle stops the polling outright
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
  useEffect(() => () => buffer.current.stop(), []);
  useEffect(() => () => { void closeScreenOcr(); }, []);
  useEffect(() => {
    if (!companionConnected || !companionToken) return;
    let cancelled = false;
    const backfill = async () => {
      const localFrames = await listScreenMemoryFrames({ limit: 120 });
      for (const frame of localFrames) {
        if (cancelled) return;
        await syncMemoryFrameToCompanion(companionToken, frame);
      }
    };
    const timer = window.setTimeout(() => void backfill(), 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [companionConnected, companionToken]);
  useEffect(() => {
    if (!stream) return;
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
        void syncMemoryFrameToCompanion(companionToken, saved);
        memoryOcrQueue.current = memoryOcrQueue.current.then(async () => {
          if (cancelled) return;
          const text = await recognizeScreenText(saved.imageUrl);
          if (text) {
            const updated = await updateScreenMemoryFrame(saved.id, { text });
            if (updated) await syncMemoryFrameToCompanion(companionToken, updated);
          }
        });
      } finally { working = false; }
    };
    const first = window.setTimeout(() => void persist(), 1_000);
    const timer = window.setInterval(() => void persist(), 4_000);
    return () => { cancelled = true; window.clearTimeout(first); window.clearInterval(timer); };
  }, [companionToken, stream]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadAgentThreads(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAgentThreads]);
  useEffect(() => {
    if (deliveryTarget !== "claude") return;
    const timer = window.setTimeout(() => void loadClaudeThreads(), 0);
    return () => window.clearTimeout(timer);
  }, [deliveryTarget, loadClaudeThreads]);
  useEffect(() => {
    if (!pendingCapture) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") cancelPendingCapture(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelPendingCapture, pendingCapture]);
  // Browser-tab-scoped hotkeys: only ever sees keydown while this tab has
  // focus (no OS hook, unlike AirPointer's global ones), so alt-tabbing away
  // silently drops it -- that trade is the whole point of this being the
  // no-install path. `status` is a dep (not a ref) purely so a stray repeat
  // keydown during an in-flight analyze doesn't fire a second overlapping
  // request; the listener itself is cheap to re-attach.
  useEffect(() => {
    if (!browserHotkeyEnabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Only bail for actual text-entry targets -- a checkbox/radio is also
      // an <input> but typing a shortcut while one happens to hold focus
      // (e.g. right after clicking this very toggle) should still fire.
      const target = event.target as HTMLElement | null;
      const isTextEntry = target && (target.tagName === "TEXTAREA" || target.isContentEditable
        || (target.tagName === "INPUT" && !["checkbox", "radio"].includes((target as HTMLInputElement).type)));
      if (isTextEntry) return;
      if (status === "analyzing" || status === "preparing") return;
      const combo = comboFromKeyEvent(event);
      if (!combo) return;
      if (combo === browserHotkeyBindings.screenshot) { event.preventDefault(); void analyzeWithOpenAI("current"); }
      else if (combo === browserHotkeyBindings.replay) { event.preventDefault(); void analyzeWithOpenAI("replay"); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [analyzeWithOpenAI, browserHotkeyBindings, browserHotkeyEnabled, status]);

  const demoActive = demoMode !== "idle";
  const demoVisualState: ReturnType<typeof demoFrameState> = demoElapsed < 2_200 ? "editing" : demoElapsed < 4_700 ? "building" : demoElapsed < 5_200 ? "error" : "failed";
  const selectedDemo = demoScenario(demoScenarioId);
  const demoVisualFrame = useMemo(() => demoActive ? demoFrameAtOffset(demoScenarioId, { editing: -30, building: -8, error: -6, failed: -0.05 }[demoVisualState]) : null, [demoActive, demoScenarioId, demoVisualState]);
  const effectiveElapsed = demoActive ? (demoElapsed / DEMO_PLAYBACK_MS) * 60_000 : elapsed;
  const bufferPercent = Math.min(100, (effectiveElapsed / (retention * 60_000)) * 100);
  const timeLabel = formatDuration(effectiveElapsed);
  const stateLabel = useMemo(() => ({ idle: "대기", recording: "로컬 기록 중", preparing: "프레임 준비", analyzing: "AI 분석 중", done: "분석 완료", error: "확인 필요" })[status], [status]);
  // companionLaunchIssue comes straight from the local spawn attempt (we know
  // for certain whether AirPointer.exe was even found), so it's authoritative
  // over the generic 30s connection-timeout message from useCompanionGesture.
  // Off localhost we have no such signal -- the OS protocol call gives no
  // feedback -- so a timeout there is genuinely ambiguous and still worth
  // suggesting a download for.
  const companionStatus = useMemo(() => {
    if (companionLaunchIssue === "missing") return { text: "AirPointer.exe를 찾을 수 없습니다.", showDownload: true };
    if (companionLaunchIssue === "error") return { text: "AirPointer 실행에 실패했습니다. 잠시 후 다시 시도해 주세요.", showDownload: false };
    if (gestureError) return { text: gestureError, showDownload: !isLocalCompanion() };
    return null;
  }, [companionLaunchIssue, gestureError]);
  const agentStateLabel = useMemo(() => ({ loading: "연결 중", idle: "AGENT 대기", preparing: "맥락 고정 중", drafting: "프롬프트 대기", sending: "AGENT 전송 중", queued: "AGENT 전송 대기", done: "AGENT 전송 완료", error: "AGENT 확인 필요" })[agentState], [agentState]);
  // Hotkey mode never starts the camera, so there's no "카메라 준비 중" stage --
  // once the native process answers at all, it's ready.
  const dockHudLabel = !gestureEnabled ? "동작 대기"
    : !companionConnected ? "AirPointer 연결 대기 중"
    : hotkeyMode ? (companionReady ? "단축키 대기 중" : "AirPointer 연결 대기 중")
    : !companionReady ? "카메라 준비 중"
    : pose === "palm" ? "손바닥 인식" : pose === "fist" ? "주먹 인식" : pose === "point" ? "검지 인식" : pose === "none" ? "손 찾는 중" : "동작 대기";
  const dockLoadingLabel = hotkeyMode ? "AirPointer 시작 중" : companionConnected ? "카메라 준비 중" : "AirPointer 연결 중";
  const dockBadgeLabel = gestureEnabled && companionReady ? (hotkeyMode ? "HOTKEY · EXE" : "CAM 01 · EXE") : "EXE 연결 안 됨";
  const pipelineStages = viewMode === "browser" ? BROWSER_PIPELINE_STAGES : NATIVE_PIPELINE_STAGES;

  useEffect(() => {
    if (!demoActive || status !== "done") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    analysisSectionRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [demoActive, status]);

  return (
    <main className={styles.shell}>
      {pipContainer && createPortal(<BrowserCapturePanel key={stream?.id ?? demoMode} active={Boolean(stream) || demoActive} busy={demoMode === "playing" || status === "preparing" || status === "analyzing"} elapsed={effectiveElapsed} retention={retention} seconds={sendSeconds} onSecondsChange={setSendSeconds} bookmarkCount={replayBookmarks.length} bookmarkEnabled={Boolean(stream)} onBookmark={addReplayBookmark} frames={frames} highlight={!demoActive && proactiveDetectionEnabled ? highlight : null} exploration={exploration} snapshot={snapshot} analyze={analyzeWithOpenAI} initialExpanded={demoActive} demoMode={demoMode} demoQuestion={demoQuestion} privacyEnabled={privacyEnabled} onPrivacyEnabledChange={setPrivacyEnabled} privacyZone={privacyZone} onPrivacyZoneChange={setPrivacyZone} privacyReport={privacyReport} />, pipContainer)}
      <header className={styles.nav}>
        <a className={styles.brand} href="#top" aria-label="방금그거뭐였지 홈"><span className={styles.brandMark} aria-hidden="true">↺</span><span>방금그거뭐였지</span></a>
        <div className={styles.modeSwitch} role="tablist" aria-label="기능 범위 선택">
          <button type="button" role="tab" aria-selected={viewMode === "browser"} data-active={viewMode === "browser"} onClick={() => setViewMode("browser")}>브라우저 모드</button>
          <button type="button" role="tab" aria-selected={viewMode === "full"} data-active={viewMode === "full"} onClick={() => setViewMode("full")}>Full Access</button>
        </div>
        <div className={styles.navMeta}><span className={styles.localBadge}><LockKey size={14} weight="bold" /> LOCAL BUFFER</span><a href="#how">작동 원리</a><a href="#privacy">개인정보</a><a href="#pipeline">파이프라인</a></div>
      </header>
      {viewMode === "full" && !gestureEnabled && <div className={styles.modeNotice}>
        <span>Full Access는 별도 프로그램(AirPointer) 설치가 필요합니다 — 설치 전에도 아래에서 미리 둘러볼 수 있어요.</span>
        <a href={AIRPOINTER_DOWNLOAD_URL}>AirPointer 다운로드</a>
      </div>}

      <section className={styles.hero} id="top">
        <div className={styles.stageColumn}>
          <div className={styles.stageHeader}><span>{demoActive ? `JUDGE DEMO · ${selectedDemo.label}` : "LIVE DESKTOP"}</span><span>{demoMode === "playing" ? "PLAYING" : demoMode === "ready" ? "REPLAY READY" : stream ? "CAPTURING" : "NOT CONNECTED"}</span></div>
          <div className={styles.stageViewport} ref={stageViewportRef}>
            <div
              className={styles.stage}
              ref={stageRef}
              style={stageBox ? { left: stageBox.left, top: stageBox.top, width: stageBox.width, height: stageBox.height } : undefined}
              onPointerDown={beginStageMove}
              onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("button, a")) resetStageBox(); }}
            >
              <video ref={screenVideo} className={`${styles.screenVideo} ${stream ? styles.visible : ""}`} muted playsInline />
              {demoActive && demoVisualFrame ? <DemoWorkspace frame={demoVisualFrame} title={selectedDemo.title} playing={demoMode === "playing"} onStop={stopDemo} /> : !stream && <div className={styles.emptyStage}><Desktop size={54} weight="thin" /><strong>방금 지나간 화면을 놓치지 마세요</strong><span>공유한 화면은 브라우저 메모리 안에서만 순환합니다.</span><label className={styles.demoScenarioPicker}><span>체험 시나리오</span><select value={demoScenarioId} onChange={(event) => { const id = event.target.value as DemoScenarioId; setDemoScenarioId(id); setDemoQuestion(demoScenario(id).question); }}>{DEMO_SCENARIOS.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.label} · {scenario.title}</option>)}</select><small>{selectedDemo.detail}</small></label><div className={styles.emptyActions}><button className={styles.primary} onClick={() => void startSharing()}><Play size={18} weight="fill" /> 화면 공유 시작</button><button className={styles.demoStart} onClick={() => void startDemo()}><Sparkle size={18} weight="fill" /> 이 시나리오로 체험</button></div></div>}
              {stream && <div className={styles.liveFlag}><span /> REC</div>}
              <div className={styles.nowLine} style={{ left: `${Math.max(2, bufferPercent)}%` }}><span>NOW</span></div>
              {RESIZE_DIRS.map(({ dir, label }) => (
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
            <div className={styles.bufferTrack} aria-label={`버퍼 ${Math.round(bufferPercent)}퍼센트`}><span style={{ width: `${bufferPercent}%` }} /></div>
            <span>{retention}:00</span>
            {demoActive ? <button className={styles.iconButton} onClick={stopDemo} aria-label="샘플 체험 종료"><Stop size={16} weight="fill" /></button> : stream ? <button className={styles.iconButton} onClick={stopSharing} aria-label="화면 공유 중지"><Stop size={16} weight="fill" /></button> : <button className={styles.iconButton} onClick={() => void startSharing()} aria-label="화면 공유 시작"><Play size={16} weight="fill" /></button>}
          </div>
        </div>

        <aside className={styles.commandDock}>
          <div className={styles.eyebrowRow}><p className={styles.eyebrow}>{viewMode === "browser" ? "BROWSER REPLAY" : "REPLAY TO AGENT"}</p><button type="button" className={styles.settingsButton} onClick={() => void openPromptSettings()} aria-label="프롬프트 설정"><Gear size={15} /></button></div>
          {viewMode === "full" && <>
            <div className={`${styles.cameraPanel} ${styles.commandCamera}`} data-connected={gestureEnabled && companionReady}>
              {!hotkeyMode && companionPreview && <img src={companionPreview} alt="AirPointer 카메라 미리보기" />}
              {gestureEnabled && !companionReady && <div className={styles.cameraLoading} role="status">{companionStatus ? <><WarningCircle size={26} /><p>{companionStatus.text}</p>{companionStatus.showDownload && <a href={AIRPOINTER_DOWNLOAD_URL}>AirPointer 다운로드</a>}</> : <><CircleNotch className={styles.spin} size={26} /><p>{dockLoadingLabel}… {bootProgress}%</p><div className={styles.cameraLoadingBar} aria-hidden="true"><span style={{ width: `${bootProgress}%` }} /></div></>}</div>}
              <div className={styles.cameraHud}><span><HandPalm size={16} /> {dockHudLabel}</span><span>{dockBadgeLabel}</span></div>
              {!hotkeyMode && gestureEnabled && gestureProgress.phase !== "idle" && gestureSelection.phase === "idle" && <div className={styles.gestureTimer} data-active role="progressbar" aria-label="제스처 유지 시간" aria-valuemin={0} aria-valuemax={1} aria-valuenow={gestureProgress.value}><div className={styles.gestureTimerRing} style={{ background: `conic-gradient(var(--accent) ${gestureProgress.value * 360}deg, rgba(255,255,255,.14) 0deg)` }}><span><b>{Math.round(gestureProgress.value * 100)}</b></span></div><p>손바닥 2초</p></div>}
            </div>
            <p className={styles.settingsGroupLabel}>시작 모드 · AirPointer를 켜기 전에 선택하세요</p>
            <div className={styles.gestureActions} aria-label="시작 모드 선택">
              <LaunchModeOption label="제스처 모드" detail="카메라로 손동작 인식" active={launchMode === "gesture"} disabled={gestureEnabled} onSelect={() => setLaunchMode("gesture")} />
              <LaunchModeOption label="단축키 모드" detail="카메라 없이 키보드로" active={launchMode === "hotkey"} disabled={gestureEnabled} onSelect={() => setLaunchMode("hotkey")} />
            </div>
            <div className={styles.gestureControls}><label className={styles.switch}><input type="checkbox" checked={gestureEnabled} onChange={(event) => changeGestureEnabled(event.target.checked)} /><span /><b>{launchMode === "hotkey" ? "단축키" : "제스처"} + AirPointer {gestureEnabled ? "켜짐" : "켜기"}</b></label><a className={styles.downloadLink} href={AIRPOINTER_DOWNLOAD_URL}>AirPointer 처음이신가요? 다운로드</a></div>
            {launchMode === "gesture" && <div className={styles.gestureActions} aria-label="제스처별 설정">
              <GestureActionToggle label="손바닥 2초" detail="15초 REPLAY" checked={gestureActions.replay} disabled={!gestureEnabled} onChange={(value) => setGestureAction("replay", value)} />
              <GestureActionToggle label="손바닥 → 주먹" detail="현재 화면" checked={gestureActions.screenshot} disabled={!gestureEnabled} onChange={(value) => setGestureAction("screenshot", value)} />
              <GestureActionToggle label="주먹 → 손바닥" detail="영역 선택" checked={gestureActions.region} disabled={!gestureEnabled} onChange={(value) => setGestureAction("region", value)} />
            </div>}
            {launchMode === "hotkey" && <>
              <p className={styles.settingsGroupLabel}>단축키 · 꺼진 상태에서도 미리 정할 수 있습니다</p>
              <div className={styles.gestureActions} aria-label="단축키 설정">
                <HotkeyRecorder label="현재 화면" combo={hotkeyBindings.screenshot} disabled={false} onChange={(value) => setHotkeyBinding("screenshot", value)} />
                <HotkeyRecorder label="최근 리플레이" combo={hotkeyBindings.replay} disabled={false} onChange={(value) => setHotkeyBinding("replay", value)} />
                <HotkeyRecorder label="영역 선택" combo={hotkeyBindings.region} disabled={false} onChange={(value) => setHotkeyBinding("region", value)} />
              </div>
            </>}
            {(companionStatus || (!companionReady && companionMessage)) && <small className={styles.gestureError}>{companionStatus ? companionStatus.text : companionMessage}{companionStatus?.showDownload && <> <a href={AIRPOINTER_DOWNLOAD_URL}>AirPointer 다운로드</a></>}</small>}
            <div className={styles.rule} />
          </>}
          <label className={styles.field}><span>로컬 버퍼</span><select value={retention} onChange={(event) => setRetention(Number(event.target.value))} disabled={Boolean(stream)}><option value={1}>최근 1분</option><option value={3}>최근 3분</option><option value={5}>최근 5분</option></select></label>
          <label className={styles.field}><span>전송 구간</span><select value={sendSeconds} onChange={(event) => setSendSeconds(Number(event.target.value))}><option value={5}>최근 5초</option><option value={15}>최근 15초</option><option value={30}>최근 30초</option><option value={60}>최근 1분</option></select></label>
          <div className={styles.apiDivider}><span>설치 없이</span><b>화면 바로 확인</b></div>
          <label className={styles.switch}><input type="checkbox" checked={privacyEnabled} disabled={status === "preparing" || status === "analyzing"} onChange={(event) => setPrivacyEnabled(event.target.checked)} /><span /><b><ShieldCheck size={16} /> 전송 전 개인정보 자동 가림</b></label>
          <div className={styles.gestureActions}><button type="button" className={styles.secondary} disabled={(!stream && !demoActive) || status === "preparing" || status === "analyzing"} onClick={() => { try { setPrivacyImage(snapshot()); setRegionImage(null); } catch { setMessage("가림 영역을 지정할 화면이 없습니다."); } }}>{privacyZone ? "가림 영역 변경" : "가림 영역 지정"}</button>{privacyZone && <button type="button" className={styles.secondary} disabled={status === "preparing" || status === "analyzing"} onClick={() => setPrivacyZone(undefined)}>가림 영역 해제</button>}</div>
          {privacyReport && <small className={styles.gestureError}>{privacyReport.scannedFrames}장 로컬 검사 · {privacyReport.maskedRegions ? `${privacyReport.maskedRegions}곳 가린 사본만 전송` : "민감정보 미검출"}</small>}
          {privacyImage && (stream || demoActive) && <PrivacyZoneEditor image={privacyImage} value={privacyZone} onCancel={() => setPrivacyImage(null)} onSave={(box) => { setPrivacyZone(box); setPrivacyImage(null); }} />}
          {demoActive ? <form className={styles.demoPrompt} onSubmit={(event) => { event.preventDefault(); if (demoMode === "ready" && demoQuestion.trim()) void analyzeWithOpenAI("replay", demoQuestion.trim()); }}>
            <div><strong>{demoMode === "playing" ? `${selectedDemo.title} 재생 중` : selectedDemo.title}</strong><span>{demoMode === "playing" ? "핵심 단서는 단 0.5초만 나타납니다." : "실사용과 동일한 AI 탐색 파이프라인으로 분석합니다."}</span></div>
            <ol className={styles.demoJourney} aria-label="심사 데모 진행 단계">
              <li data-state={demoMode === "playing" ? "active" : "done"}><b>01</b><span>순간 재생</span></li>
              <li data-state={status === "preparing" || status === "analyzing" ? "active" : status === "done" ? "done" : "next"}><b>02</b><span>AI 재탐색</span></li>
              <li data-state={status === "done" ? "done" : "next"}><b>03</b><span>근거 확인</span></li>
            </ol>
            <textarea aria-label="샘플 리플레이에 질문" value={demoQuestion} disabled={demoMode === "playing" || status === "analyzing" || status === "preparing"} onChange={(event) => setDemoQuestion(event.target.value)} maxLength={500} />
            <button type="submit" disabled={demoMode !== "ready" || !demoQuestion.trim() || status === "analyzing" || status === "preparing"}>{status === "analyzing" || status === "preparing" ? <CircleNotch className={styles.spin} size={16} /> : <Sparkle size={16} weight="fill" />}{demoMode === "playing" ? "재생이 끝나면 질문할 수 있어요" : "AI로 사라진 오류 찾기"}</button>
            {demoMode !== "playing" && <div className={styles.demoPromptLinks}><button type="button" className={styles.demoReplay} onClick={() => void startDemo()}><ArrowCounterClockwise size={14} /> 다시 재생</button><button type="button" className={styles.demoReplay} onClick={stopDemo}>다른 시나리오 선택</button></div>}
          </form> : <>
            <button className={styles.secondary} onClick={() => void analyzeWithOpenAI("replay")} disabled={!stream || status === "analyzing"}><ArrowCounterClockwise size={18} /> 최근 {sendSeconds}초 확인하기</button>
            <button className={styles.secondary} onClick={() => void analyzeWithOpenAI("current")} disabled={!stream || status === "analyzing"}><Camera size={18} /> 지금 화면 확인하기</button>
            <button className={styles.secondary} disabled={!stream || status === "preparing" || status === "analyzing"} onClick={() => { try { setRegionImage(snapshot()); } catch { setMessage("먼저 화면 공유를 시작해 주세요."); } }}><Target size={18} /> 영역 선택해서 확인하기</button>
          </>}
          {regionImage && (stream || demoActive) && <RegionCapture image={regionImage} busy={status === "preparing" || status === "analyzing"} onCancel={() => setRegionImage(null)} onSend={async (image, question) => {
            const result = await analyzeWithOpenAI("current", question, [], image);
            if ("text" in result) setRegionImage(null);
          }} />}
          <div className={styles.status} data-tone={status === "error" ? "error" : status === "done" ? "done" : "normal"}>{status === "analyzing" || status === "preparing" ? <CircleNotch className={styles.spin} size={16} /> : status === "error" ? <WarningCircle size={16} /> : status === "done" ? <Check size={16} /> : <span className={styles.statusDot} />}<div><strong>{stateLabel}</strong><span>{message}</span></div></div>
          <label className={styles.switch}><input type="checkbox" checked={browserGestureEnabled} onChange={(event) => setBrowserGestureEnabled(event.target.checked)} /><span /><b>카메라로 제스처 켜기 (브라우저, 설치 불필요)</b></label>
          {browserGestureEnabled && <div className={`${styles.cameraPanel} ${styles.commandCamera}`} data-connected={browserGestureReady}>
            {browserGesturePreview && <img src={browserGesturePreview} alt="브라우저 카메라 미리보기" />}
            {!browserGestureReady && <div className={styles.cameraLoading} role="status">{browserGestureError ? <><WarningCircle size={26} /><p>{browserGestureError}</p></> : <><CircleNotch className={styles.spin} size={26} /><p>카메라 준비 중…</p></>}</div>}
            <div className={styles.cameraHud}><span><HandPalm size={16} /> {!browserGestureReady ? "연결 대기" : browserGesturePose === "palm" ? "손바닥 인식" : browserGesturePose === "fist" ? "주먹 인식" : browserGesturePose === "point" ? "검지 인식" : browserGesturePose === "none" ? "손 찾는 중" : "동작 대기"}</span></div>
            {browserGestureProgress.phase !== "idle" && <div className={styles.gestureTimer} data-active role="progressbar" aria-label="제스처 유지 시간" aria-valuemin={0} aria-valuemax={1} aria-valuenow={browserGestureProgress.value}><div className={styles.gestureTimerRing} style={{ background: `conic-gradient(var(--accent) ${browserGestureProgress.value * 360}deg, rgba(255,255,255,.14) 0deg)` }}><span><b>{Math.round(browserGestureProgress.value * 100)}</b></span></div><p>손바닥 2초</p></div>}
          </div>}
          <label className={styles.switch}><input type="checkbox" checked={browserHotkeyEnabled} onChange={(event) => setBrowserHotkeyEnabled(event.target.checked)} /><span /><b>키보드 단축키 켜기 (브라우저, 설치 불필요)</b></label>
          {browserHotkeyEnabled && <>
            <div className={styles.gestureActions} aria-label="브라우저 단축키 설정">
              <HotkeyRecorder label="현재 화면" combo={browserHotkeyBindings.screenshot} disabled={false} onChange={(value) => setBrowserHotkeyBindings((current) => ({ ...current, screenshot: value }))} />
              <HotkeyRecorder label="최근 리플레이" combo={browserHotkeyBindings.replay} disabled={false} onChange={(value) => setBrowserHotkeyBindings((current) => ({ ...current, replay: value }))} />
            </div>
            <small className={styles.gestureError}>탭에 포커스가 있을 때만 동작합니다 — 다른 창으로 전환하면 받지 못합니다. 전역 단축키가 필요하면 AirPointer를 설치해 주세요.</small>
          </>}
          <label className={styles.switch}><input type="checkbox" checked={pipOpen} disabled={!pipSupported} onChange={(event) => { if (event.target.checked) void openCapturePip(); else closeCapturePip(); }} /><span /><b><PictureInPicture size={16} /> 항상 위 캡처 버튼 켜기 (브라우저, 설치 불필요)</b></label>
          {!pipSupported && <small className={styles.gestureError}>이 브라우저는 지원하지 않습니다. Chrome 또는 Edge 116 이상에서 사용해 주세요.</small>}
          {pipSupported && !pipMessage && <small className={styles.gestureError}>다른 창에 포커스가 가 있어도 이 작은 창의 버튼은 눌립니다 — 설치 없이 쓸 수 있는 전역 단축키 대안입니다.</small>}
          {pipMessage && <small className={styles.gestureError}>{pipMessage}</small>}
          {viewMode === "full" && <>
            <div className={styles.rule} />
            <p className={styles.settingsGroupLabel}>보낼 곳</p>
            <div className={styles.gestureActions} aria-label="보낼 곳 선택">
              <LaunchModeOption label="Codex" detail="Codex 작업 선택 후 전송" active={deliveryTarget === "codex"} disabled={false} onSelect={() => setDeliveryTarget("codex")} />
              <LaunchModeOption label="Claude Code" detail={companionToken ? "Claude Desktop 세션 선택 후 전송" : "AirPointer 연결 필요"} active={deliveryTarget === "claude"} disabled={false} onSelect={() => setDeliveryTarget("claude")} />
            </div>
            {deliveryTarget === "codex"
              ? <label className={styles.field}><span>Codex Agent</span><span className={styles.agentPicker}><SessionPicker threads={codexPickerThreads} value={agentThreadId} onChange={handleAgentThreadChange} loading={agentState === "loading"} blankLabel="작업 선택" ariaLabel="전송할 Codex 작업" /><button type="button" className={styles.agentPickerRefresh} onClick={() => void loadAgentThreads()} aria-label="Codex 작업 새로고침"><ArrowClockwise size={15} /></button></span></label>
              : companionToken
                ? <label className={styles.field}><span>Claude Session</span><span className={styles.agentPicker}><SessionPicker threads={claudeThreads} value={claudeThreadId} onChange={setClaudeThreadId} loading={claudeThreadsLoading} blankLabel="현재 열려 있는 대화" ariaLabel="전송할 Claude 세션" /><button type="button" className={styles.agentPickerRefresh} onClick={() => void loadClaudeThreads()} aria-label="Claude 세션 새로고침"><ArrowClockwise size={15} /></button></span></label>
                : <small className={styles.gestureError}>Claude Desktop으로 보내려면 위에서 AirPointer를 먼저 켜주세요.</small>}
            <button className={styles.action} onClick={() => void prepareAgentCapture("replay")} disabled={!stream || (deliveryTarget === "codex" ? !agentThreadId : !companionToken) || agentState === "preparing" || agentState === "sending" || agentState === "queued"}><PaperPlaneTilt size={20} weight="bold" /> 최근 {sendSeconds}초 Agent에 묻기</button>
            <button className={styles.secondary} onClick={() => void prepareAgentCapture("current")} disabled={!stream || (deliveryTarget === "codex" ? !agentThreadId : !companionToken) || agentState === "preparing" || agentState === "sending" || agentState === "queued"}><Camera size={18} /> 지금 화면 Agent에 묻기</button>
            <div className={styles.status} data-tone={agentState === "error" ? "error" : agentState === "done" ? "done" : "normal"}>{agentState === "loading" || agentState === "preparing" || agentState === "sending" || agentState === "queued" ? <CircleNotch className={styles.spin} size={16} /> : agentState === "error" ? <WarningCircle size={16} /> : agentState === "done" ? <Check size={16} /> : <span className={styles.statusDot} />}<div><strong>{agentStateLabel}</strong><span>{agentMessage}</span></div></div>
          </>}
        </aside>
      </section>

      <section className={styles.replaySection} id="how">
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
        <div className={styles.timelinePanel}>
          <div className={styles.timelineHead}><span>{frames.length ? exploration ? `${frames.length}/${exploration.frameBudget} FRAMES USED` : `${frames.length} FRAMES SENT` : "LOCAL RING BUFFER"}</span><span>{exploration ? `ADAPTIVE SEARCH · ${exploration.round}/${exploration.maxRounds}` : "오래된 장면 자동 삭제"}</span></div>
          <div className={styles.frames}>
            {frames.length ? frames.map((frame, index) => <figure key={`${frame.url.slice(-24)}-${index}`}>{/* Browser-generated data URLs are intentionally not passed through Next image optimization. */}<img src={frame.url} alt={`AI에 전송한 ${index + 1}번째 화면`} /><figcaption>{frame.kind === "queried-crop" ? "ZOOM · " : frame.kind === "queried-frame" ? "QUERY · " : frame.kind === "bookmarked-frame" ? "BOOKMARK · " : ""}-{frame.atSeconds.toFixed(2)}s</figcaption></figure>) : Array.from({ length: 6 }, (_, index) => <div className={styles.framePlaceholder} key={index}><span>{index + 1}</span></div>)}
          </div>
          {exploration && <div className={styles.explorationTrace} aria-label="적응형 프레임 탐색 과정">
            <div className={styles.explorationBudget}><span style={{ transform: `scaleX(${exploration.usedFrames / exploration.frameBudget})` }} /></div>
            {exploration.timing && <div className={styles.analysisTiming} aria-label="분석 성능 측정"><strong>총 {(exploration.timing.totalMs / 1000).toFixed(1)}초</strong><span>캡처 {(exploration.timing.captureMs / 1000).toFixed(1)}s</span><span>가림 {(exploration.timing.privacyMs / 1000).toFixed(1)}s</span><span>AI {(exploration.timing.apiMs / 1000).toFixed(1)}s</span><span>재탐색 {(exploration.timing.replayMs / 1000).toFixed(1)}s</span><span>근거 {(exploration.timing.evidenceMs / 1000).toFixed(1)}s</span></div>}
            <ol>{exploration.steps.map((step, index) => <li key={`${step.label}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><p><b>{step.label}</b><small>{step.detail}</small></p><em>+{step.added} frames</em></li>)}</ol>
          </div>}
          <div className={styles.ruler}><span /><i style={{ left: `${bufferPercent}%` }} /></div>
        </div>
        <AnimatePresence mode="wait">
          {(status === "analyzing" || analysis) && <motion.article ref={analysisSectionRef} className={styles.analysis} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className={styles.analysisLabel}><span>AI</span><p>{status === "analyzing" ? "화면 변화 읽는 중" : "방금 일어난 일"}</p></div>
            <div>{status === "analyzing" ? <div className={styles.analysisLoading}><span /><span /><span /></div> : <>
              <p>{analysis}</p>
              {analysisEvidence.length ? <section className={styles.analysisEvidence} aria-label="답변 화면 근거">
                <div className={styles.analysisEvidenceHeading}><strong>화면 근거</strong><span>{analysisEvidence.length}개</span></div>
                <ol>{analysisEvidence.map(({ claim, frame }, index) => <li key={`${frame.capturedAt ?? frame.atSeconds}-${index}`}>
                  <button type="button" aria-label={`${claim} 근거 타임머신 열기`} aria-expanded={analysisEvidencePreview === index} onClick={() => setAnalysisEvidencePreview(index)}>
                    <img src={frame.url} alt="답변을 뒷받침하는 화면" />
                    <span><small>{frame.kind === "queried-frame" ? "추가 조회 · " : ""}{frame.atSeconds > 0.005 ? `-${frame.atSeconds.toFixed(2)}초` : "현재"}</small><b>{claim}</b></span>
                  </button>
                </li>)}</ol>
              </section> : null}
              {captureContext && <details><summary>전송 정보</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{captureContext}</pre></details>}
            </>}</div>
          </motion.article>}
        </AnimatePresence>
        {analysisEvidencePreview !== null && analysisEvidence[analysisEvidencePreview] && <EvidenceTimeMachine evidence={analysisEvidence[analysisEvidencePreview]} onClose={() => setAnalysisEvidencePreview(null)} />}
      </section>

      <ScreenMemoryWorkbench recording={Boolean(stream)} companionConnected={companionConnected} companionToken={companionToken} onAddToReplay={addMemoryFrameToReplay} />

      <section className={styles.gestureSection} id="privacy">
        <div className={styles.gestureCopy}><p className={styles.eyebrow}>{viewMode === "browser" ? "ZERO-INSTALL CONTROL" : "GESTURE SHORTCUT"}</p><h2>{viewMode === "browser" ? <>설치 없이<br />놓친 순간을 찾습니다.</> : <>화면에서 손을<br />떼지 않아도 됩니다.</>}</h2><p>{viewMode === "browser" ? "화면 공유 뒤 현재 화면·최근 리플레이·선택 영역을 바로 분석합니다. PiP 창과 브라우저 단축키로 다른 작업 중에도 캡처할 수 있습니다." : "손바닥 2초는 최근 15초, 손바닥 다음 주먹은 현재 화면을 Agent에게 보냅니다. 주먹 다음 손바닥은 영역 선택을 시작하며, 레이저 포인터는 이 때만 표시됩니다."}</p></div>
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
          <motion.section className={styles.promptDialog} role="dialog" aria-modal="true" aria-label="Agent에게 질문" initial={{ opacity: 0, y: 24, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: .98 }}>
            <div className={styles.promptHeader}><button type="button" onClick={cancelPendingCapture} disabled={agentState === "sending" || agentState === "queued"} aria-label="질문 창 닫기"><X size={20} /></button></div>
            <p className={styles.captureSummary}>{pendingCapture.mode === "replay" ? `최근 ${pendingCapture.seconds}초 맥락 · ${pendingCapture.capsule.overviewFrames.length}개 개요 + 원본 구간` : pendingCapture.region ? "선택 영역" : "현재 화면"}</p>
            <div className={styles.promptChoices} aria-label="추천 질문">{PROMPT_PRESETS.map((preset) => <button type="button" key={preset} onClick={() => setAgentPrompt(preset)} aria-pressed={agentPrompt === preset}>{preset}</button>)}</div>
            <label className={styles.promptInput}><span>직접 질문</span><textarea autoFocus value={agentPrompt} maxLength={2000} placeholder="예: 0.5초 전에 잠깐 뜬 오류가 뭐였고 어떻게 해결해?" onChange={(event) => setAgentPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submitPendingCapture(); } }} /></label>
            <div className={styles.promptFooter}><p><b>{agentPrompt.length}</b> / 2000 · Enter 전송 · Shift+Enter 줄바꿈</p><div><button type="button" className={styles.promptCancel} onClick={cancelPendingCapture} disabled={agentState === "sending" || agentState === "queued"}>취소</button><button type="button" className={styles.promptSend} onClick={() => void submitPendingCapture()} disabled={!agentPrompt.trim() || agentState === "sending" || agentState === "queued"}>{agentState === "sending" || agentState === "queued" ? <CircleNotch className={styles.spin} size={17} /> : <PaperPlaneTilt size={17} weight="bold" />} 질문과 함께 전송</button></div></div>
          </motion.section>
        </motion.div>}
      </AnimatePresence>

      <AnimatePresence>
        {promptSettingsOpen && <motion.div className={styles.promptBackdrop} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.section className={styles.promptDialog} role="dialog" aria-modal="true" aria-labelledby="prompt-settings-title" initial={{ opacity: 0, y: 24, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: .98 }}>
            <div className={styles.promptHeader}><div><p>PROMPT TEMPLATE</p><h2 id="prompt-settings-title">Codex에게 보낼 프롬프트 설정</h2></div><button type="button" onClick={() => setPromptSettingsOpen(false)} aria-label="설정 창 닫기"><X size={20} /></button></div>
            <p className={styles.settingsHint}>매번 직접 입력하는 질문(요청) 내용은 여기서 바꿀 수 없습니다. 그 질문을 감싸는 문구만 편집합니다.</p>
            {promptSettingsState === "loading" && <div className={styles.settingsLoading}><CircleNotch className={styles.spin} size={20} /> 불러오는 중…</div>}
            {promptTemplate && promptSettingsState !== "loading" && <div className={styles.settingsForm}>
              <label className={styles.settingsField}><span>마무리 문구</span><input type="text" value={promptTemplate.wrapperOutro} onChange={(event) => setPromptTemplate({ ...promptTemplate, wrapperOutro: event.target.value })} /></label>
              <label className={styles.settingsField}><span>최근 활성 창 이력 라벨 · AirPointer.exe 캡처에만 붙음</span><input type="text" value={promptTemplate.windowHistoryLabel} onChange={(event) => setPromptTemplate({ ...promptTemplate, windowHistoryLabel: event.target.value })} /></label>
              <p className={styles.settingsGroupLabel}>질문을 안 남겼을 때 기본 질문</p>
              {(["screenshot", "region", "replay"] as const).map((kind) => <label className={styles.settingsField} key={`default-${kind}`}><span>{{ screenshot: "현재 화면", region: "선택 영역", replay: "최근 화면 기록" }[kind]}</span><input type="text" value={promptTemplate.defaultRequestByKind[kind]} onChange={(event) => setPromptTemplate({ ...promptTemplate, defaultRequestByKind: { ...promptTemplate.defaultRequestByKind, [kind]: event.target.value } })} /></label>)}
              <p className={styles.settingsGroupLabel}>Replay Capsule 전용 (손바닥 2초 홀드로 보낼 때)</p>
              <label className={styles.settingsField}><span>도입 문구 · <code>{"{seconds}"}</code> 사용 가능</span><input type="text" value={promptTemplate.capsuleIntro} onChange={(event) => setPromptTemplate({ ...promptTemplate, capsuleIntro: event.target.value })} /></label>
              <label className={styles.settingsField}><span>조회 안내 문구</span><textarea value={promptTemplate.capsuleInstruction} onChange={(event) => setPromptTemplate({ ...promptTemplate, capsuleInstruction: event.target.value })} /></label>
            </div>}
            {promptSettingsMessage && <p className={styles.settingsMessage} data-tone={promptSettingsState === "error" ? "error" : "normal"}>{promptSettingsMessage}</p>}
            <div className={styles.promptFooter}><p>편집 즉시 저장되지 않습니다.</p><div><button type="button" className={styles.promptCancel} onClick={() => void resetPromptSettings()} disabled={promptSettingsState === "loading" || promptSettingsState === "saving"}>기본값으로 초기화</button><button type="button" className={styles.promptSend} onClick={() => void savePromptSettings()} disabled={!promptTemplate || promptSettingsState === "loading" || promptSettingsState === "saving"}>{promptSettingsState === "saving" ? <CircleNotch className={styles.spin} size={17} /> : <Check size={17} weight="bold" />} 저장</button></div></div>
          </motion.section>
        </motion.div>}
      </AnimatePresence>

      <section className={styles.pipelineSection} id="pipeline">
        <p className={styles.eyebrow}>{viewMode === "browser" ? "HOW REPLAY FINDS IT" : "HOW AIRPOINTER THINKS"}</p>
        <h2>{viewMode === "browser" ? <>다섯 단계로<br />사라진 근거를 찾습니다.</> : <>다섯 단계로<br />화면이 Agent에 도착합니다.</>}</h2>
        <div className={styles.pipelineTrack}>
          <div className={styles.pipelineLine} aria-hidden="true"><span className={styles.pipelineBeam} /></div>
          {pipelineStages.map(({ Icon, label, detail }, index) => (
            <div className={styles.pipelineNode} style={{ "--i": index } as React.CSSProperties} key={label}>
              <span className={styles.pipelineIcon}><Icon size={20} weight="bold" /></span>
              <span className={styles.pipelineText}><b>{label}</b><small>{detail}</small></span>
            </div>
          ))}
        </div>

        {/* Off (or on with nothing to show yet), this renders DEMO_SCORE_CHART
            -- a hand-drawn curve, not a live readout. Checked while AirPointer
            is running, it renders liveScoreChart instead: real per-frame
            scores from _ChangeTracker.observe(), plumbed through
            ScreenReplayBuffer.recent_scores() -> companion_bridge.py's
            publish_scores() -> this page's /status poll. Either way the
            rendering below is the same code path -- see ScoreChart above. */}
        <div className={styles.scorePanel}>
          <div className={styles.scorePanelHead}>
            <span>TILE DIFF SCORE{showLiveScore && " · LIVE"}</span>
            <div className={styles.scorePanelHeadRight}>
              <span>_ChangeTracker.observe()</span>
              <label className={styles.scoreLiveToggle} data-available={liveScoreAvailable} title={liveScoreAvailable ? undefined : "AirPointer 연결 시 사용 가능"}>
                <input type="checkbox" checked={liveScoreEnabled} onChange={(event) => setLiveScoreEnabled(event.target.checked)} />
                <span>실시간 연동</span>
              </label>
            </div>
          </div>
          <p className={styles.scoreCaption}>프레임마다 화면이 바뀐 정도를 점수로 매깁니다. 점선(임계값)을 넘는 구간을 하나의 &ldquo;이벤트&rdquo;로 묶고, 그 안에서 점수가 가장 높은 프레임을 대표 프레임으로 뽑습니다.</p>
          {liveScoreEnabled && !showLiveScore && (
            <p className={styles.scoreLiveHint}>
              {!liveScoreAvailable ? "AirPointer 연결 대기 중 — 그동안 데모 곡선을 보여줍니다." : "데이터를 모으는 중입니다 — 그동안 데모 곡선을 보여줍니다."}
            </p>
          )}
          <div className={styles.scoreChart}>
            <svg viewBox="0 0 600 140" preserveAspectRatio="none">
              <line x1="0" y1={scoreChart.thresholdY} x2="600" y2={scoreChart.thresholdY} className={styles.scoreThreshold} />
              {scoreChart.bands.map((band, index) => (
                <rect key={index} x={band.x} y="0" width={band.width} height="140" className={styles.scoreBand} />
              ))}
              <polyline className={styles.scoreLine} points={scoreChart.points} />
              {scoreChart.peaks.map((peak, index) => (
                <rect key={index} x={peak.x - 4} y={peak.y - 4} width="8" height="8" className={styles.scorePeak} />
              ))}
            </svg>
            {!showLiveScore && <span className={styles.scorePlayhead} />}
            <span className={styles.scoreAxisLabel} data-corner="top-left">점수 높음 ↑</span>
            <span className={styles.scoreAxisLabel} data-corner="bottom-right">시간 →</span>
            <span className={styles.scoreThresholdLabel} style={{ top: `calc(${(scoreChart.thresholdY / 140) * 100}% - 16px)` }}>임계값</span>
            {scoreChart.bands.map((band, index) => (
              <span className={styles.scoreEventLabel} style={{ left: `${((band.x + band.width / 2) / 600) * 100}%` }} key={index}>이벤트 구간</span>
            ))}
            {scoreChart.peaks.map((peak, index) => (
              <span className={styles.scorePeakLabel} style={{ left: `${(peak.x / 600) * 100}%` }} key={index}>대표 프레임</span>
            ))}
          </div>
          <div className={styles.scoreLegend}>
            <span>diff score</span>
            <span>{showLiveScore ? `THRESHOLD · GLOBAL_MIN_SCORE ${liveScoreThreshold} (전역 기준만, 타일 기준 생략)` : "THRESHOLD · GLOBAL_MIN_SCORE 0.02 / TILE_MIN_SCORE 0.15"}</span>
            <span>{scoreChart.peaks.length ? `PEAK ${scoreChart.peaks.map((peak) => peak.score.toFixed(2)).join(" · ")}` : "PEAK 없음"}</span>
          </div>
        </div>
      </section>

      <footer className={styles.footer}><span>방금그거뭐였지</span><span>AI Championship 2026 Prototype</span><span>Built for moments that disappear.</span></footer>
    </main>
  );
}

function DemoWorkspace({ frame, title, playing, onStop }: { frame: OverviewFrame; title: string; playing: boolean; onStop: () => void }) {
  return <div className={styles.demoWorkspace}>
    <img className={styles.demoFrame} src={frame.url} alt={`${title} 샘플 작업 화면`} />
    <div className={styles.demoTitlebar}><span><i />{title}</span><b>{playing ? "60초 압축 재생" : "리플레이 준비 완료"}</b><button type="button" onClick={onStop}>체험 종료</button></div>
  </div>;
}

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1_000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

// Buckets by `project` in order of first appearance (not sorted-input
// run-length grouping): Claude's threads already arrive project-block
// ordered (see App._list_companion_threads / desktop_paste.py's
// _claude_sidebar_rows), where this reduces to the same thing, but Codex's
// don't -- its threads are updatedAt-sorted with cwd-derived projects
// interleaved, so first-appearance-order bucketing is what actually keeps
// each project's items together for Codex too.
function groupPickerThreads(threads: PickerThread[]): [string, PickerThread[]][] {
  const order: string[] = [];
  const buckets = new Map<string, PickerThread[]>();
  for (const thread of threads) {
    if (!buckets.has(thread.project)) { buckets.set(thread.project, []); order.push(thread.project); }
    buckets.get(thread.project)!.push(thread);
  }
  return order.map((project) => [project, buckets.get(project)!]);
}

// Codex's AgentThread has no project field, only `cwd` (a full filesystem
// path) -- the trailing folder name is a reasonable proxy for "project",
// matching how the folders/projects in Claude's own sidebar are named.
function pathBasename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

function GestureActionToggle({ label, detail, checked, disabled, onChange }: { label: string; detail: string; checked: boolean; disabled: boolean; onChange: (checked: boolean) => void }) {
  return <label className={styles.gestureAction} data-active={checked && !disabled}><span><b>{label}</b><small>{detail}</small></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i>{checked ? "ON" : "OFF"}</i></label>;
}

function LaunchModeOption({ label, detail, active, disabled, onSelect }: { label: string; detail: string; active: boolean; disabled: boolean; onSelect: () => void }) {
  return <label className={styles.gestureAction} data-active={active}><span><b>{label}</b><small>{detail}</small></span><input type="radio" name="airpointer-launch-mode" checked={active} disabled={disabled} onChange={onSelect} /><i>{active ? "●" : "○"}</i></label>;
}

// A hand-drawn dropdown, not a native <select> -- a real <select>'s open
// popup is OS/browser-drawn and its background/text colors can't be
// reliably controlled together (see the back-and-forth this replaced: a
// plain option/optgroup styling attempt showed readable rows in some spots
// and blank ones in others, inconsistently, because <option> nested inside
// an <optgroup> doesn't reliably inherit color the same way a top-level
// <option> does, and there's no way to add a project-row accent layer to a
// native popup at all). This renders entirely in our own DOM instead, so
// every color and the project-row accent border are exactly what's coded
// here, with no browser-dependent guessing.
function SessionPicker({ threads, value, onChange, loading, blankLabel, ariaLabel }: {
  threads: PickerThread[]; value: string; onChange: (id: string) => void; loading: boolean;
  blankLabel: string; ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Always an explicit viewport-fixed coordinate once the panel is open --
  // set on open (anchored under/over the trigger, whichever fits) and
  // updated live while dragging the handle. Rendered through a portal
  // straight into document.body (see the return below): an ancestor with
  // any `transform` (framer-motion's <motion.*> wrappers apply one even at
  // rest) turns position:fixed into "fixed relative to that ancestor"
  // instead of the viewport, which is exactly why the panel used to jump
  // off-screen the instant a drag started -- the portal sidesteps that
  // ancestor chain entirely, same as a real popup layer would.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = threads.find((thread) => thread.id === value);
  const label = selected ? selected.title : blankLabel;

  const normalizedQuery = query.trim().toLowerCase();
  const filteredThreads = normalizedQuery
    ? threads.filter((thread) => thread.title.toLowerCase().includes(normalizedQuery))
    : threads;
  const groups = useMemo(() => groupPickerThreads(filteredThreads), [filteredThreads]);

  // Closing always clears the search query and position too -- folded into
  // one helper (rather than a separate reset-on-close effect) so every
  // close path (trigger toggle, outside click, Escape, picking an item)
  // goes through one place instead of a setState-in-effect.
  const close = () => { setOpen(false); setQuery(""); setPos(null); };

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = pos ?? panelRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const onMove = (moveEvent: PointerEvent) => {
      setPos({ left: origin.left + (moveEvent.clientX - startX), top: origin.top + (moveEvent.clientY - startY) });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const toggleOpen = () => {
    if (open) { close(); return; }
    if (rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const roomBelow = window.innerHeight - rect.bottom;
      const openUpward = roomBelow < 540 && rect.top > roomBelow;
      // 520 here matches customPickerPanel's default height -- an estimate
      // (the user may have resized it last time, but the panel always
      // remounts at the default size, see the CSS comment there), same
      // margin/spacing (4px) the old anchored CSS used.
      setPos({ left: rect.left, top: openUpward ? rect.top - 520 - 4 : rect.bottom + 4 });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const pick = (id: string) => { onChange(id); close(); };

  return (
    <div className={styles.customPicker} ref={rootRef}>
      <button type="button" className={styles.customPickerTrigger} onClick={toggleOpen}
              disabled={loading} aria-haspopup="listbox" aria-expanded={open}>
        <span>{label}</span>
        <CaretDown size={13} weight="bold" />
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} className={styles.customPickerPanel}
             style={{ left: pos.left, top: pos.top }}>
          <div className={styles.customPickerDragHandle} onPointerDown={startDrag} title="드래그해서 옮기기">
            <DotsSixVertical size={13} weight="bold" />
          </div>
          <div className={styles.customPickerSearch}>
            <MagnifyingGlass size={14} />
            <input ref={searchRef} type="text" value={query} placeholder="세션 검색..."
                   onChange={(event) => setQuery(event.target.value)}
                   onKeyDown={(event) => event.stopPropagation()} />
          </div>
          <div role="listbox" aria-label={ariaLabel} className={styles.customPickerList}>
            {!normalizedQuery && (
              <div className={styles.customPickerOption} data-active={!value} role="option" aria-selected={!value}
                   onClick={() => pick("")}>{blankLabel}</div>
            )}
            {groups.map(([project, groupThreads]) => (
              <div key={project || "__misc__"}>
                {project && <div className={styles.customPickerGroup}>{project}</div>}
                {groupThreads.map((thread) => (
                  <div key={thread.id} className={styles.customPickerOption} data-active={thread.id === value}
                       role="option" aria-selected={thread.id === value} onClick={() => pick(thread.id)}>
                    {thread.active ? "● " : ""}{thread.title}
                  </div>
                ))}
              </div>
            ))}
            {normalizedQuery && groups.length === 0 && (
              <div className={styles.customPickerEmpty}>일치하는 세션이 없습니다.</div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

const HOTKEY_MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

// Shared by HotkeyRecorder (recording a combo to send to AirPointer) and the
// browserHotkeyEnabled window.keydown listener above (matching a live
// keypress against browserHotkeyBindings) -- same "ctrl+alt+s"-style
// vocabulary either way. A recorded combo destined for AirPointer is sent
// verbatim and parsed by airpointer/hotkeys.py's parse_binding -- keep the
// vocabulary (modifier names, JS's own event.key spelling for named keys
// like "ArrowUp"/"Escape") in sync with that function if either side changes.
// Takes a structural subset (not KeyboardEvent itself) so it works for both
// React's synthetic event (HotkeyRecorder) and the native one (the
// window-level listener).
function comboFromKeyEvent(event: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  if (HOTKEY_MODIFIER_KEYS.has(event.key)) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (event.metaKey) parts.push("win");
  if (!parts.length) return null; // a bare key would register as a global hotkey -- reject, keep waiting
  parts.push(event.key === " " ? "space" : event.key.toLowerCase());
  return parts.join("+");
}

function HotkeyRecorder({ label, combo, disabled, onChange }: { label: string; combo: string; disabled: boolean; onChange: (combo: string) => void }) {
  const [recording, setRecording] = useState(false);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    event.preventDefault();
    if (event.key === "Escape") { setRecording(false); return; }
    const combo = comboFromKeyEvent(event);
    if (!combo) return;
    onChange(combo);
    setRecording(false);
  };

  return (
    <div className={styles.gestureAction} data-active={!disabled}>
      <span><b>{label}</b><small>{combo.toUpperCase()}</small></span>
      <button type="button" disabled={disabled} onClick={() => setRecording(true)}
              onKeyDown={onKeyDown} onBlur={() => setRecording(false)}>
        {recording ? "키 입력 대기…" : "변경"}
      </button>
    </div>
  );
}

const isLocalCompanion = () => typeof window !== "undefined" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

// Local dev spawns AirPointer.exe directly and can tell us exactly why that
// failed (missing file vs. some other spawn error); returns undefined when
// there's nothing more specific to say (production, or the "quit" command).
function launchAirPointer(command: "start" | "start_hotkey" | "quit", token: string): Promise<"missing" | "error" | undefined> | undefined {
  if (isLocalCompanion()) {
    const request = fetch("/api/companion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, token }),
    });
    if (command === "quit") { void request; return undefined; }
    return request
      .then(async (response) => {
        if (response.ok) return undefined;
        const body = await response.json().catch(() => ({}) as { error?: string });
        return /ENOENT|no such file/i.test(body.error || "") ? "missing" : "error";
      })
      .catch(() => "error" as const);
  }
  // This is an external OS protocol, not an internal Next.js route.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `${AIRPOINTER_PROTOCOL}${command}?token=${encodeURIComponent(token)}`;
  return undefined;
}

function dataUrlToBlob(value: string) {
  const [header, payload] = value.split(",", 2);
  const mimeType = /^data:([^;]+);base64$/.exec(header)?.[1] || "image/jpeg";
  const binary = window.atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}
