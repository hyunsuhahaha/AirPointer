"use client";

import { useEffect, useState } from "react";
import type { GesturePose, GestureProgress, RegionSelectionView } from "@/lib/gesture";

type GestureActions = { replay: boolean; screenshot: boolean; region: boolean };
type Options = { enabled: boolean; token: string; agentThreadId: string; gestures: GestureActions };
type Snapshot = {
  running: boolean;
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

export function useCompanionGesture({ enabled, token, agentThreadId, gestures }: Options) {
  const [pose, setPose] = useState<GesturePose>("none");
  const [progress, setProgress] = useState<GestureProgress>(IDLE_PROGRESS);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled || !token) {
      return;
    }
    let cancelled = false;
    let timer = 0;
    let failures = 0;
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
            body: JSON.stringify({ agentThreadId, gestures }),
          });
          if (!configResponse.ok) throw new Error("companion configuration failed");
          syncedAgentThreadId = agentThreadId;
        }
        if (cancelled) return;
        failures = 0; setError(""); setPose(state.pose); setPreview(state.preview);
        const palmActive = state.route === "replay" && (state.phase === "arming" || state.phase === "armed");
        setProgress(palmActive ? { phase: "holding", value: state.progress, command: null } : IDLE_PROGRESS);
      } catch {
        failures += 1;
        if (failures >= 300 && !cancelled) setError("AirPointer를 시작하지 못했습니다. EXE 파일과 카메라 상태를 확인해 주세요.");
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 100);
      }
    };
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [agentThreadId, enabled, gestures, token]);

  return {
    pose: enabled ? pose : "none" as GesturePose,
    progress: enabled ? progress : IDLE_PROGRESS,
    preview: enabled ? preview : "",
    selection: IDLE_SELECTION,
    error: enabled ? error : "",
  };
}
