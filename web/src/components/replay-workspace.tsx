"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowClockwise, ArrowCounterClockwise, Camera, CaretDown, Check, CircleNotch, Desktop, DotsSixVertical, Gear, HandPalm, LockKey, MagnifyingGlass, PaperPlaneTilt, Play, Stop, WarningCircle, X } from "@phosphor-icons/react";
import { useCompanionGesture } from "@/hooks/use-companion-gesture";
import type { HotkeyBindings } from "@/hooks/use-companion-gesture";
import { BrowserReplayBuffer, frameFromVideo } from "@/lib/replay-buffer";
import type { ReplayCapsule } from "@/lib/replay-buffer";
import type { PromptTemplate } from "@/lib/prompt-template";
import styles from "./replay-workspace.module.css";

type Status = "idle" | "recording" | "preparing" | "analyzing" | "done" | "error";
type Mode = "current" | "replay";
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
  | { mode: "current"; threadId: string; seconds: number; frames: string[]; region?: boolean }
  | { mode: "replay"; threadId: string; seconds: number; capsule: ReplayCapsule };
type GestureAction = "replay" | "screenshot" | "region";
type StageBox = { left: number; top: number; width: number; height: number };
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const PROMPT_PRESETS = [
  "이 상황이 어떻게 된 건지 설명해줘",
  "문제 원인과 해결 방법을 찾아줘",
  "여기서 다음에 무엇을 해야 하는지 알려줘",
];

const STAGE_MIN_WIDTH = 320;
const STAGE_MIN_HEIGHT = 220;

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
  const [frames, setFrames] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState("");
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
  const [promptTemplate, setPromptTemplate] = useState<PromptTemplate | null>(null);
  const [promptSettingsState, setPromptSettingsState] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [promptSettingsMessage, setPromptSettingsMessage] = useState("");

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
  }, [agentThreadId, captureFrames, companionToken, deliveryTarget, sendSeconds, stream]);

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
        data = await postToCompanion(frames, kind, prompt);
      } else if (pendingCapture.mode === "replay") {
        const { capsule } = pendingCapture;
        const form = new FormData();
        form.set("metadata", JSON.stringify({ threadId: pendingCapture.threadId, mode: pendingCapture.mode, seconds: pendingCapture.seconds, userPrompt: prompt, startedAt: capsule.startedAt, triggeredAt: capsule.triggeredAt, segments: capsule.segments.map(({ startedAt, durationMs, blob }) => ({ startedAt, durationMs, mimeType: blob.type })) }));
        capsule.overviewFrames.forEach((frame, index) => form.append("overview", dataUrlToBlob(frame), `overview-${String(index + 1).padStart(2, "0")}.jpg`));
        capsule.segments.forEach((segment, index) => form.append("segment", segment.blob, `segment-${String(index + 1).padStart(3, "0")}.webm`));
        data = await postCapsuleToAgent(form);
      } else {
        data = await postToAgent({ threadId: pendingCapture.threadId, mode: pendingCapture.mode, kind: pendingCapture.region ? "region" : "screenshot", seconds: pendingCapture.seconds, frames: pendingCapture.frames, userPrompt: prompt });
      }
      const label = pendingCapture.mode === "replay" ? `최근 ${pendingCapture.seconds}초 Replay Capsule` : pendingCapture.region ? "선택 영역" : "현재 화면";
      setPendingCapture(null); setAgentPrompt(""); setAgentState("done");
      setAgentMessage(deliveryTarget === "claude"
        ? `${label}과 질문을 Claude Code에 보냈습니다.`
        : `${label}과 질문을 Codex 작업에 보냈습니다. (${data.turnId})`);
    } catch (reason) {
      setAgentState("error");
      setAgentMessage(reason instanceof Error ? reason.message
        : deliveryTarget === "claude" ? "Claude Desktop 전송에 실패했습니다." : "Codex Agent 전송에 실패했습니다.");
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

  const { pose, progress: gestureProgress, preview: companionPreview, selection: gestureSelection, error: gestureError, ready: companionReady, connected: companionConnected, activeMode } = useCompanionGesture({ enabled: gestureEnabled, token: companionToken, agentThreadId, gestures: gestureActions, hotkeys: hotkeyBindings, deliveryTarget });
  const hotkeyMode = activeMode ? activeMode === "hotkey" : launchMode === "hotkey";

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
  useEffect(() => { buffer.current.setRetention(retention); }, [retention]);
  useEffect(() => () => buffer.current.stop(), []);
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

  const bufferPercent = Math.min(100, (elapsed / (retention * 60_000)) * 100);
  const timeLabel = formatDuration(elapsed);
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

  return (
    <main className={styles.shell}>
      <header className={styles.nav}>
        <a className={styles.brand} href="#top" aria-label="방금그거뭐였지 홈"><span className={styles.brandMark} aria-hidden="true">↺</span><span>방금그거뭐였지</span></a>
        <div className={styles.navMeta}><span className={styles.localBadge}><LockKey size={14} weight="bold" /> LOCAL BUFFER</span><a href="#how">작동 원리</a><a href="#privacy">개인정보</a></div>
      </header>

      <section className={styles.hero} id="top">
        <div className={styles.stageColumn}>
          <div className={styles.stageHeader}><span>LIVE DESKTOP</span><span>{stream ? "CAPTURING" : "NOT CONNECTED"}</span></div>
          <div className={styles.stageViewport} ref={stageViewportRef}>
            <div
              className={styles.stage}
              ref={stageRef}
              style={stageBox ? { left: stageBox.left, top: stageBox.top, width: stageBox.width, height: stageBox.height } : undefined}
              onPointerDown={beginStageMove}
              onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("button, a")) resetStageBox(); }}
            >
              <video ref={screenVideo} className={`${styles.screenVideo} ${stream ? styles.visible : ""}`} muted playsInline />
              {!stream && <div className={styles.emptyStage}><Desktop size={54} weight="thin" /><strong>방금 지나간 화면을 놓치지 마세요</strong><span>공유한 화면은 브라우저 메모리 안에서만 순환합니다.</span><button className={styles.primary} onClick={() => void startSharing()}><Play size={18} weight="fill" /> 화면 공유 시작</button></div>}
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
            {stream ? <button className={styles.iconButton} onClick={stopSharing} aria-label="화면 공유 중지"><Stop size={16} weight="fill" /></button> : <button className={styles.iconButton} onClick={() => void startSharing()} aria-label="화면 공유 시작"><Play size={16} weight="fill" /></button>}
          </div>
        </div>

        <aside className={styles.commandDock}>
          <div className={styles.eyebrowRow}><p className={styles.eyebrow}>REPLAY TO AGENT</p><button type="button" className={styles.settingsButton} onClick={() => void openPromptSettings()} aria-label="프롬프트 설정"><Gear size={15} /></button></div>
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
          <label className={styles.field}><span>로컬 버퍼</span><select value={retention} onChange={(event) => setRetention(Number(event.target.value))} disabled={Boolean(stream)}><option value={1}>최근 1분</option><option value={3}>최근 3분</option><option value={5}>최근 5분</option></select></label>
          <label className={styles.field}><span>전송 구간</span><select value={sendSeconds} onChange={(event) => setSendSeconds(Number(event.target.value))}><option value={5}>최근 5초</option><option value={15}>최근 15초</option><option value={30}>최근 30초</option><option value={60}>최근 1분</option></select></label>
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

      <footer className={styles.footer}><span>방금그거뭐였지</span><span>AI Championship 2026 Prototype</span><span>Built for moments that disappear.</span></footer>
    </main>
  );
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

// A recorded combo is sent to AirPointer verbatim as e.g. "ctrl+alt+s" and
// parsed by airpointer/hotkeys.py's parse_binding -- keep the vocabulary
// (modifier names, and JS's own event.key spelling for named keys like
// "ArrowUp"/"Escape") in sync with that function if either side changes.
function HotkeyRecorder({ label, combo, disabled, onChange }: { label: string; combo: string; disabled: boolean; onChange: (combo: string) => void }) {
  const [recording, setRecording] = useState(false);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    event.preventDefault();
    if (event.key === "Escape") { setRecording(false); return; }
    if (HOTKEY_MODIFIER_KEYS.has(event.key)) return;
    const parts: string[] = [];
    if (event.ctrlKey) parts.push("ctrl");
    if (event.altKey) parts.push("alt");
    if (event.shiftKey) parts.push("shift");
    if (event.metaKey) parts.push("win");
    if (!parts.length) return; // a bare key would register as a global hotkey -- reject, keep waiting
    parts.push(event.key === " " ? "space" : event.key.toLowerCase());
    onChange(parts.join("+"));
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
