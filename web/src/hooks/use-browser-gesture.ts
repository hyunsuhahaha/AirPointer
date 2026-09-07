"use client";

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { GestureCommandDetector, classifyHand } from "@/lib/gesture";
import type { GestureCommand, GesturePose, GestureProgress } from "@/lib/gesture";

// Same CDN hosts already allowed by proxy.ts's CSP connect-src. Runs entirely
// in the browser -- no AirPointer companion, no server round-trip -- so this
// is the one native gesture feature judges without the native app installed
// can still experience.
const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const PREVIEW_INTERVAL_MS = 150;
const IDLE_PROGRESS: GestureProgress = { phase: "idle", value: 0, command: null };

type Options = { enabled: boolean; onCommand: (command: GestureCommand) => void };

// Only the "손바닥 2초" replay-send gesture is wired up (see
// GestureCommandDetector) -- region selection is a separate, much larger
// feature (native lets the REAL mouse drag the region after the gesture
// arms it) that nothing in the web app implements yet, browser-tracked hand
// or not.
export function useBrowserHandGesture({ enabled, onCommand }: Options) {
  const [pose, setPose] = useState<GesturePose>("none");
  const [progress, setProgress] = useState<GestureProgress>(IDLE_PROGRESS);
  const [preview, setPreview] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  // Ref, not a dependency, so passing a fresh inline callback each render
  // doesn't tear down and restart the camera/model on every render.
  const onCommandRef = useRef(onCommand);
  useEffect(() => { onCommandRef.current = onCommand; }, [onCommand]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let landmarker: HandLandmarker | null = null;
    let frameHandle = 0;
    let lastPreviewAt = 0;
    const detector = new GestureCommandDetector();
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    const canvas = document.createElement("canvas");

    const loop = () => {
      if (cancelled) return;
      if (landmarker && video.readyState >= 2) {
        const now = Date.now();
        const result = landmarker.detectForVideo(video, now);
        const landmarks = result.landmarks[0];
        const nextPose = landmarks ? classifyHand(landmarks) : "none";
        setPose(nextPose);
        const command = detector.update(nextPose, now);
        setProgress(detector.progress(now));
        if (command) onCommandRef.current(command);
        if (now - lastPreviewAt >= PREVIEW_INTERVAL_MS && video.videoWidth) {
          lastPreviewAt = now;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext("2d")!.drawImage(video, 0, 0);
          setPreview(canvas.toDataURL("image/jpeg", 0.5));
        }
      }
      frameHandle = requestAnimationFrame(loop);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 180 } });
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        video.srcObject = stream;
        await video.play();
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL },
          runningMode: "VIDEO",
          numHands: 1,
        });
        if (cancelled) { landmarker.close(); return; }
        setReady(true);
        frameHandle = requestAnimationFrame(loop);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "카메라를 시작하지 못했습니다.");
      }
    })();

    return () => {
      cancelled = true;
      if (frameHandle) cancelAnimationFrame(frameHandle);
      stream?.getTracks().forEach((track) => track.stop());
      landmarker?.close();
    };
  }, [enabled]);

  // Mask instead of resetting the underlying state on disable -- same
  // pattern as useCompanionGesture -- so turning the toggle off doesn't need
  // its own setState-in-effect just to zero everything out.
  return {
    pose: enabled ? pose : "none" as GesturePose,
    progress: enabled ? progress : IDLE_PROGRESS,
    preview: enabled ? preview : "",
    ready: enabled && ready,
    error: enabled ? error : "",
  };
}
