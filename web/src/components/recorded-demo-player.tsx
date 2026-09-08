"use client";

import { useEffect, useRef } from "react";
import { InteractiveReplay, type RecordedScene } from "@/lib/interactive-replay";
import type { DemoScenario } from "@/lib/demo-replay";

export function RecordedDemoPlayer({ scenario, onProgress, onReady, onError }: {
  scenario: DemoScenario;
  onProgress: (seconds: number, duration: number) => void;
  onReady: (replay: InteractiveReplay) => void;
  onError: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const scenes = useRef<RecordedScene[]>([]);
  const startedAt = useRef(0);
  const finished = useRef(false);

  useEffect(() => {
    const player = video.current;
    if (!player) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1280; canvas.height = 720;
    const context = canvas.getContext("2d");
    const capture = () => {
      if (!context || player.readyState < 2) return;
      if (!startedAt.current) startedAt.current = Date.now() - player.currentTime * 1000;
      context.drawImage(player, 0, 0, canvas.width, canvas.height);
      scenes.current.push({ url: canvas.toDataURL("image/jpeg", .86), at: startedAt.current + player.currentTime * 1000, focusBox: scenario.focusBox });
      if (scenes.current.length > 80) scenes.current.shift();
      onProgress(player.currentTime, Number.isFinite(player.duration) ? player.duration : 10);
    };
    const timer = window.setInterval(capture, 250);
    const ended = () => {
      capture();
      if (finished.current || !scenes.current.length) return;
      finished.current = true;
      const triggeredAt = startedAt.current + player.duration * 1000;
      onReady(new InteractiveReplay(scenes.current, triggeredAt, canvas.width, canvas.height));
    };
    player.addEventListener("ended", ended);
    void player.play().catch(onError);
    return () => { window.clearInterval(timer); player.removeEventListener("ended", ended); };
  }, [scenario, onError, onProgress, onReady]);

  return <video ref={video} src={scenario.video} muted playsInline autoPlay preload="auto" aria-label={`${scenario.title} 실제 개발환경 녹화`} />;
}
