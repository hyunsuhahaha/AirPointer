"use client";

import { useEffect, useState } from "react";
import type { GesturePose, GestureProgress, RegionSelectionView } from "@/lib/gesture";

type GestureActions = { replay: boolean; screenshot: boolean; region: boolean };
export type HotkeyBindings = { replay: string; screenshot: string; region: string };
type Options = { enabled: boolean; token: string; agentThreadId: string; gestures: GestureActions; hotkeys: HotkeyBindings };
type Snapshot = {
  running: boolean;
  mode: "gesture" | "hotkey" | null;
  cameraReady: boolean;
  pose: GesturePose;
  phase: "idle" | "arming" | "armed" | "cooldown";
  progress: number;
  route: "replay" | "screenshot" | null;
  replayEvent: number;
  preview: string;
};

const IDLE_PROGRESS: GestureProgress = { phase: "idle", value: 0, command: null };
const IDLE_SELECTION: RegionSelectionView = { phase: "idle", rect: null, pointer: null, progress: 0, captured: null };

export function useCompanionGesture({ enabled, token, agentThreadId, gestures, hotkeys }: Options) {
  const [pose, setPose] = useState<GesturePose>("none");
  const [progress, setProgress] = useState<GestureProgress>(IDLE_PROGRESS);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [readyToken, setReadyToken] = useState("");
  const [activeMode, setActiveMode] = useState<"gesture" | "hotkey" | null>(null);
  // Distinct from `ready` (companion running AND camera warmed up): this only
  // tracks whether the companion's status server has ever answered at all,
  // so the UI can tell "AirPointer isn't running" apart from "it's running
  // but hasn't spotted a hand yet" -- both would otherwise look identical
  // (pose stuck at its "none" default).
  const [connected, setConnected] = useState(false);
  // Reset `connected` the moment a new poll session starts (enabled flips on,
  // or the token changes) so a stale "connected" from a previous session
  // never leaks into the first render of a new one. Done during render --
  // React's supported way to adjust state when an input changes -- rather
  // than as a setState call inside the effect below.
  const sessionKey = enabled ? token : "";
  const [trackedSessionKey, setTrackedSessionKey] = useState(sessionKey);
  if (sessionKey !== trackedSessionKey) {
    setTrackedSessionKey(sessionKey);
    setConnected(false);
  }

  useEffect(() => {
    if (!enabled || !token) {
      return;
    }
    let cancelled = false;
    let timer = 0;
    let firstFailureAt = 0;
    let syncedAgentThreadId: string | null = null;
    const localProxy = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    const statusUrl = localProxy ? `/api/companion?token=${encodeURIComponent(token)}` : `http://127.0.0.1:47822/status?token=${encodeURIComponent(token)}`;
    const configUrl = localProxy ? `/api/companion?token=${encodeURIComponent(token)}` : `http://127.0.0.1:47822/config?token=${encodeURIComponent(token)}`;

    const poll = async () => {
      try {
        const response = await fetch(statusUrl, { cache: "no-store" });
        if (!response.ok) throw new Error("companion unavailable");
        const state = await response.json() as Snapshot;
        if (syncedAgentThreadId !== agentThreadId) {
          const configResponse = await fetch(configUrl, {
            method: localProxy ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentThreadId, gestures, hotkeys }),
          });
          if (!configResponse.ok) throw new Error("companion configuration failed");
          syncedAgentThreadId = agentThreadId;
        }
        if (cancelled) return;
        // Hotkey mode never touches the camera, so cameraReady never turns
        // true there -- readiness in that mode is just "the process says
        // it's running," same as gesture mode is once the camera warms up.
        const ready = state.running && (state.mode === "hotkey" || state.cameraReady);
        firstFailureAt = 0; setError(""); setConnected(true); setReadyToken(ready ? token : ""); setActiveMode(state.mode); setPose(state.pose); setPreview(state.preview);
        const palmActive = state.route === "replay" && (state.phase === "arming" || state.phase === "armed");
        setProgress(palmActive ? { phase: "holding", value: state.progress, command: null } : IDLE_PROGRESS);
      } catch {
        setReadyToken(""); setActiveMode(null);
        if (!firstFailureAt) firstFailureAt = Date.now();
        // A freshly built/downloaded AirPointer.exe is a PyInstaller onefile
        // bundle: Windows extracts it to a temp dir AND, being an unrecognized
        // binary, Defender/SmartScreen scans it before it's allowed to run at
        // all -- both can genuinely take minutes on a cold start, well past
        // any reasonable "did the process even launch" check. Erroring out
        // early here was a false positive: the exe was still coming up and
        // would connect fine seconds later, self-clearing this same error.
        if (Date.now() - firstFailureAt >= 180_000 && !cancelled) setError("AirPointer를 시작하지 못했습니다. EXE 파일과 카메라 상태를 확인해 주세요.");
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 100);
      }
    };
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [agentThreadId, enabled, gestures, hotkeys, token]);

  return {
    pose: enabled ? pose : "none" as GesturePose,
    progress: enabled ? progress : IDLE_PROGRESS,
    preview: enabled ? preview : "",
    selection: IDLE_SELECTION,
    error: enabled ? error : "",
    ready: enabled && readyToken === token,
    connected: enabled && connected,
    activeMode: enabled ? activeMode : null,
  };
}
