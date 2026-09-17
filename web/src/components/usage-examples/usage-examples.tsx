"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowCounterClockwise, Pause, Play, SpeakerHigh, SpeakerSlash, X } from "@phosphor-icons/react";
import { createOverviewSound } from "@/lib/overview-sound";
import type { OverviewSound } from "@/lib/overview-sound";
import * as bisectScript from "@/lib/usage-example-bisect";
import * as classScript from "@/lib/usage-example-class";
import * as flashScript from "@/lib/usage-example-flash";
import * as game from "@/lib/usage-example-game";
import * as installScript from "@/lib/usage-example-install";
import * as meetingScript from "@/lib/usage-example-meeting";
import * as motionScript from "@/lib/usage-example-motion";
import * as qaScript from "@/lib/usage-example-qa";
import { STAGE } from "@/lib/usage-example-timeline";
import * as toastScript from "@/lib/usage-example-toast";
import type { CueSound } from "@/lib/usage-example-timeline";
import { BisectExample } from "./bisect-example";
import { ClassExample } from "./class-example";
import { FlashExample } from "./flash-example";
import { GameExample } from "./game-example";
import { InstallExample } from "./install-example";
import { MeetingExample } from "./meeting-example";
import { MotionExample } from "./motion-example";
import { QaExample } from "./qa-example";
import { ToastExample } from "./toast-example";
import styles from "./usage-examples.module.css";

export type DeliveryMode = "manual" | "link" | "folder";
export const DELIVERY_MODE_NAMES: Record<DeliveryMode, string> = { manual: "Manual", link: "Agent Link", folder: "Local Folder" };

type Example = {
  id: string; role: string; title: string; mode: DeliveryMode; duration: number; speed: number;
  sounds: { at: number; sound: CueSound }[]; typing: [number, number][];
  Scene: (props: { t: number }) => ReactNode;
};

// "라면" after a vowel, "이라면" after a final consonant (직장인이라면).
export const ramyeon = (word: string) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? "이라면" : "라면";
};

// New examples are added here; the top bar reads "당신이 {role}라면?" and
// lists the roles in order.
const EXAMPLES: Example[] = [
  { id: "toast", role: "웹 개발자", title: "“버튼이 안 눌려요”", mode: "link", duration: toastScript.DURATION, speed: toastScript.SPEED, sounds: toastScript.SOUND_CUES, typing: toastScript.TYPING, Scene: ToastExample },
  { id: "flash", role: "디자이너", title: "“이 번쩍임, 저만 보여요?”", mode: "link", duration: flashScript.DURATION, speed: flashScript.SPEED, sounds: flashScript.SOUND_CUES, typing: flashScript.TYPING, Scene: FlashExample },
  { id: "meeting", role: "회의하는 직장인", title: "“방금 그 차트 뭐였죠?”", mode: "manual", duration: meetingScript.DURATION, speed: meetingScript.SPEED, sounds: meetingScript.SOUND_CUES, typing: meetingScript.TYPING, Scene: MeetingExample },
  { id: "motion", role: "퍼블리셔", title: "“이거랑 똑같이 해줘”", mode: "manual", duration: motionScript.DURATION, speed: motionScript.SPEED, sounds: motionScript.SOUND_CUES, typing: motionScript.TYPING, Scene: MotionExample },
  { id: "qa", role: "QA 엔지니어", title: "“재현 절차 좀 적어주세요”", mode: "link", duration: qaScript.DURATION, speed: qaScript.SPEED, sounds: qaScript.SOUND_CUES, typing: qaScript.TYPING, Scene: QaExample },
  { id: "class", role: "코딩 강사", title: "“아까 그 명령어 뭐였죠?”", mode: "link", duration: classScript.DURATION, speed: classScript.SPEED, sounds: classScript.SOUND_CUES, typing: classScript.TYPING, Scene: ClassExample },
  { id: "game", role: "게임 개발자", title: "“이 노란 네모 뭐야?”", mode: "manual", duration: game.DURATION, speed: game.SPEED, sounds: game.SOUND_CUES, typing: game.TYPING, Scene: GameExample },
  { id: "install", role: "인프라 엔지니어", title: "“가이드대로 했는데 왜 안 돼?”", mode: "folder", duration: installScript.DURATION, speed: installScript.SPEED, sounds: installScript.SOUND_CUES, typing: installScript.TYPING, Scene: InstallExample },
  { id: "vibe", role: "바이브 코더", title: "“뭘 고치다 버튼이 사라졌지?”", mode: "folder", duration: bisectScript.DURATION, speed: bisectScript.SPEED, sounds: bisectScript.SOUND_CUES, typing: bisectScript.TYPING, Scene: BisectExample },
];

const MAX_TYPING_CLICKS_PER_SECOND = 14;
export const examplesFor = (mode?: DeliveryMode) => mode ? EXAMPLES.filter((example) => example.mode === mode) : EXAMPLES;

// `mode` narrows the list to one delivery mode (from the lobby's mode guide);
// with a single match the example starts right away.
export function UsageExamples({ onClose, mode }: { onClose: () => void; mode?: DeliveryMode }) {
  const [examples] = useState(() => examplesFor(mode));
  const dialog = useRef<HTMLDivElement>(null);
  const sound = useRef<OverviewSound | null>(null);
  const clock = useRef(0);
  // Nothing plays until a role is picked on the opening "당신이 … 라면?" screen.
  const [exampleIndex, setExampleIndex] = useState<number | null>(examples.length === 1 ? 0 : null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(examples.length === 1);
  const [muted, setMuted] = useState(false);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const example = exampleIndex === null ? null : examples[exampleIndex];

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
    if (!playing || !example) return;
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
  const togglePlaying = () => {
    if (!example) return;
    if (clock.current >= example.duration) restart(); else setPlaying((current) => !current);
  };
  const toggleMuted = () => setMuted((current) => { sound.current?.setMuted(!current); return !current; });

  const topBar = 64;
  const scale = Math.min((viewport.width - 32) / STAGE.width, (viewport.height - topBar - 24) / STAGE.height);
  const ended = example !== null && t >= example.duration;
  const pickedRole = hoverIndex ?? exampleIndex;

  return createPortal(
    <div ref={dialog} className={`${styles.overlay} theme-fixed`} role="dialog" aria-modal="true" aria-label="실제 활용 예시" tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        else if (event.key === " ") togglePlaying();
        else return;
        event.preventDefault();
      }}>
      <header className={styles.topBar}>
        {example && <div className={styles.sentence}>
          <span>당신이</span>
          <nav className={styles.tabs} aria-label="직업 선택">
            {examples.map((item, index) => <button key={item.id} type="button" aria-pressed={index === exampleIndex} onClick={() => selectExample(index)}>
              {item.role}
            </button>)}
          </nav>
          <span>{ramyeon(example.role)}?</span>
        </div>}
        <div className={styles.controls}>
          <button type="button" onClick={toggleMuted} aria-label={muted ? "소리 켜기" : "소리 끄기"}>{muted ? <SpeakerSlash size={16} /> : <SpeakerHigh size={16} />}</button>
          {example && <>
            <button type="button" onClick={togglePlaying} aria-label={playing ? "일시정지" : "재생"}>{playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}</button>
            <button type="button" onClick={restart} aria-label="처음부터"><ArrowCounterClockwise size={16} /></button>
          </>}
          <button type="button" onClick={onClose} aria-label="예시 닫기"><X size={16} weight="bold" /></button>
        </div>
      </header>
      {!example && <section className={styles.chooser} aria-label="직업 고르기">
        {mode && <p className={styles.chooserMode}>{DELIVERY_MODE_NAMES[mode]} 활용 예시</p>}
        <h2>당신이 <span className={styles.blank} data-filled={pickedRole !== null}>{pickedRole === null ? "?" : examples[pickedRole].role}</span> {pickedRole === null ? "라면" : ramyeon(examples[pickedRole].role)}?</h2>
        <div className={styles.roleCards}>
          {examples.map((item, index) => <button key={item.id} type="button" onClick={() => selectExample(index)}
            onPointerEnter={() => setHoverIndex(index)} onPointerLeave={() => setHoverIndex(null)} onFocus={() => setHoverIndex(index)} onBlur={() => setHoverIndex(null)}>
            <b>{item.role}</b><small>{item.title}</small>
          </button>)}
        </div>
      </section>}
      {example && <div className={styles.stageArea}>
        <div className={styles.stage} aria-label={example.title}
          style={{ width: STAGE.width, height: STAGE.height, transform: `translate(-50%, -50%) scale(${scale})` }}>
          <example.Scene t={t} />
          {ended && <div className={styles.endCard}>
            <small>당신이 {example.role}{ramyeon(example.role)}</small>
            <strong>{example.title}, 한 번에 해결</strong>
            <div>
              <button type="button" className={styles.primary} onClick={restart}><ArrowCounterClockwise size={16} /> 다시 보기</button>
              <button type="button" onClick={onClose}>닫기</button>
            </div>
          </div>}
        </div>
      </div>}
      {example && <div className={styles.progress} aria-hidden="true"><span style={{ width: `${(t / example.duration) * 100}%` }} /></div>}
    </div>,
    document.body,
  );
}
