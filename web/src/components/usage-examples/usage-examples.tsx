"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowCounterClockwise, Pause, Play, SpeakerHigh, SpeakerSlash, X } from "@phosphor-icons/react";
import { createOverviewSound } from "@/lib/overview-sound";
import type { OverviewSound } from "@/lib/overview-sound";
import * as corsScript from "@/lib/usage-example-cors";
import * as game from "@/lib/usage-example-game";
import { STAGE } from "@/lib/usage-example-timeline";
import * as toastScript from "@/lib/usage-example-toast";
import type { CueSound } from "@/lib/usage-example-timeline";
import * as vmScript from "@/lib/usage-example-vm";
import { CorsExample } from "./cors-example";
import { GameExample } from "./game-example";
import { ToastExample } from "./toast-example";
import { VmExample } from "./vm-example";
import styles from "./usage-examples.module.css";

type Example = {
  id: string; label: string; title: string; duration: number; speed: number;
  sounds: { at: number; sound: CueSound }[]; typing: [number, number][];
  Scene: (props: { t: number }) => ReactNode;
};

// New examples are added here; the tab bar lists them in order.
const EXAMPLES: Example[] = [
  { id: "toast", label: "웹 개발", title: "안 눌리는 버튼", duration: toastScript.DURATION, speed: toastScript.SPEED, sounds: toastScript.SOUND_CUES, typing: toastScript.TYPING, Scene: ToastExample },
  { id: "cors", label: "API 연동", title: "CORS 아닌 CORS 에러", duration: corsScript.DURATION, speed: corsScript.SPEED, sounds: corsScript.SOUND_CUES, typing: corsScript.TYPING, Scene: CorsExample },
  { id: "game", label: "게임 개발", title: "공격하면 번쩍이는 노란 네모", duration: game.DURATION, speed: game.SPEED, sounds: game.SOUND_CUES, typing: game.TYPING, Scene: GameExample },
  { id: "vm", label: "VM 설정", title: "이유 없이 안 켜지는 VM", duration: vmScript.DURATION, speed: vmScript.SPEED, sounds: vmScript.SOUND_CUES, typing: vmScript.TYPING, Scene: VmExample },
];

const MAX_TYPING_CLICKS_PER_SECOND = 14;
export function UsageExamples({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const sound = useRef<OverviewSound | null>(null);
  const clock = useRef(0);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const example = EXAMPLES[exampleIndex];

  useEffect(() => {
    sound.current = createOverviewSound();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      document.body.style.overflow = previousOverflow;
      sound.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const previous = clock.current;
      const next = Math.min(example.duration, previous + Math.min(0.1, (now - last) / 1_000) * example.speed);
      last = now;
      clock.current = next;
      const audio = sound.current;
      if (audio) {
        for (const cue of example.sounds) if (previous < cue.at && next >= cue.at) audio[cue.sound]();
        for (const [start, end] of example.typing) {
          if (next <= start || previous >= end) continue;
          const span = Math.min(next, end) - Math.max(previous, start);
          const clicks = Math.max(1, Math.round(span * MAX_TYPING_CLICKS_PER_SECOND));
          for (let index = 0; index < clicks; index++) audio.keyClick((span * index) / clicks);
        }
      }
      setT(next);
      if (next >= example.duration) { setPlaying(false); return; }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [example, playing]);

  const restart = useCallback(() => { clock.current = 0; setT(0); setPlaying(true); }, []);
  const selectExample = (index: number) => { setExampleIndex(index); restart(); };
  const togglePlaying = () => { if (clock.current >= example.duration) restart(); else setPlaying((current) => !current); };
  const toggleMuted = () => setMuted((current) => { sound.current?.setMuted(!current); return !current; });

  const topBar = 64;
  const scale = Math.min((viewport.width - 32) / STAGE.width, (viewport.height - topBar - 24) / STAGE.height);
  const ended = t >= example.duration;
  const Scene = example.Scene;

  return createPortal(
    <div ref={dialog} className={styles.overlay} role="dialog" aria-modal="true" aria-label="실제 활용 예시" tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        else if (event.key === " ") togglePlaying();
        else return;
        event.preventDefault();
      }}>
      <header className={styles.topBar}>
        <strong>실제 활용 예시</strong>
        <nav className={styles.tabs} aria-label="예시 목록">
          {EXAMPLES.map((item, index) => <button key={item.id} type="button" aria-pressed={index === exampleIndex} onClick={() => selectExample(index)}>
            <b>{String(index + 1).padStart(2, "0")}</b>{item.label}
          </button>)}
        </nav>
        <div className={styles.controls}>
          <button type="button" onClick={toggleMuted} aria-label={muted ? "소리 켜기" : "소리 끄기"}>{muted ? <SpeakerSlash size={16} /> : <SpeakerHigh size={16} />}</button>
          <button type="button" onClick={togglePlaying} aria-label={playing ? "일시정지" : "재생"}>{playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}</button>
          <button type="button" onClick={restart} aria-label="처음부터"><ArrowCounterClockwise size={16} /></button>
          <button type="button" onClick={onClose} aria-label="예시 닫기"><X size={16} weight="bold" /></button>
        </div>
      </header>
      <div className={styles.stageArea}>
        <div className={styles.stage} aria-label={example.title}
          style={{ width: STAGE.width, height: STAGE.height, transform: `translate(-50%, -50%) scale(${scale})` }}>
          <Scene t={t} />
          {ended && <div className={styles.endCard}>
            <small>예시 {String(exampleIndex + 1).padStart(2, "0")} · {example.label}</small>
            <strong>{example.title}, 한 번에 해결</strong>
            <div>
              <button type="button" className={styles.primary} onClick={restart}><ArrowCounterClockwise size={16} /> 다시 보기</button>
              <button type="button" onClick={onClose}>닫기</button>
            </div>
          </div>}
        </div>
      </div>
      <div className={styles.progress} aria-hidden="true"><span style={{ width: `${(t / example.duration) * 100}%` }} /></div>
    </div>,
    document.body,
  );
}
