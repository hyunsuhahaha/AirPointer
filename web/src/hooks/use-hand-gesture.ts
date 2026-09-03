"use client";

import { useEffect, useState } from "react";
import { classifyHand, GestureCommandDetector, type GestureCommand, type GesturePose } from "@/lib/gesture";

type Options = { enabled: boolean; videoRef: React.RefObject<HTMLVideoElement | null>; canvasRef: React.RefObject<HTMLCanvasElement | null>; onCommand: (command: GestureCommand) => void };

export function useHandGesture({ enabled, videoRef, canvasRef, onCommand }: Options) {
  const [pose, setPose] = useState<GesturePose>("none");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let animation = 0;
    let stream: MediaStream | null = null;
    const canvasElement = canvasRef.current;
    let recognizer: { recognizeForVideo: (video: HTMLVideoElement, time: number) => { landmarks?: Array<Array<{ x: number; y: number }>> }; close: () => void } | null = null;
    const detector = new GestureCommandDetector();
    let lastInference = 0;

    async function boot() {
      try {
        const vision = await import("@mediapipe/tasks-vision");
        const files = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm");
        recognizer = await vision.GestureRecognizer.createFromOptions(files, {
          baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task", delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.55,
          minTrackingConfidence: 0.55,
        });
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false });
        if (!videoRef.current || cancelled) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        loop();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "카메라를 시작하지 못했습니다.");
      }
    }

    function loop(now = performance.now()) {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasElement;
      if (recognizer && video && canvas && video.readyState >= 2 && now - lastInference >= 32) {
        lastInference = now;
        const result = recognizer.recognizeForVideo(video, now);
        const landmarks = result.landmarks?.[0] ?? [];
        const nextPose = classifyHand(landmarks);
        setPose((previous) => previous === nextPose ? previous : nextPose);
        drawHand(canvas, landmarks);
        const command = detector.update(nextPose, now);
        if (command) onCommand(command);
      }
      animation = requestAnimationFrame(loop);
    }

    void boot();
    return () => {
      cancelled = true;
      cancelAnimationFrame(animation);
      stream?.getTracks().forEach((track) => track.stop());
      recognizer?.close();
      const canvas = canvasElement;
      if (canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [enabled, canvasRef, onCommand, videoRef]);

  return { pose: enabled ? pose : "none", error };
}

function drawHand(canvas: HTMLCanvasElement, points: Array<{ x: number; y: number }>) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const bounds = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(bounds.width * window.devicePixelRatio));
  canvas.height = Math.max(1, Math.round(bounds.height * window.devicePixelRatio));
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!points.length) return;
  const links = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  context.strokeStyle = "#ff6b22";
  context.fillStyle = "#fff2ea";
  context.lineWidth = 2.2 * window.devicePixelRatio;
  for (const [a, b] of links) {
    context.beginPath();
    context.moveTo((1 - points[a].x) * canvas.width, points[a].y * canvas.height);
    context.lineTo((1 - points[b].x) * canvas.width, points[b].y * canvas.height);
    context.stroke();
  }
  for (const point of points) {
    context.beginPath();
    context.arc((1 - point.x) * canvas.width, point.y * canvas.height, 2.2 * window.devicePixelRatio, 0, Math.PI * 2);
    context.fill();
  }
}
