"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowCounterClockwise, ArrowRight, Pause, Play, SkipForward, SpeakerHigh, SpeakerSlash, X } from "@phosphor-icons/react";
import {
  ART, FLASH_CUES, LOG_RAIN, LOG_VANISH_AT, RANT, TIMELINE, TOAST_CUES,
  cameraAt, nextSceneTime, revealedChars, sceneAt, stageAt,
} from "@/lib/overview-script";
import { createOverviewSound } from "@/lib/overview-sound";
import type { OverviewSound } from "@/lib/overview-sound";
import styles from "./project-overview.module.css";

const ART_SRC = "/overview/capture-error-solution.webp";
const FLASH_SPOTS: [number, number][] = [[14, 20], [58, 14], [34, 54], [66, 46], [22, 68], [50, 30], [72, 62], [40, 18], [8, 44], [62, 72]];
const LOG_LINES = Array.from({ length: 64 }, (_, index) => {
  const level = ["ERROR", "INFO", "WARN", "ERROR", "INFO"][index % 5];
  const message = ["Unexpected state: null", "Retrying request...", "Deprecated API call", "Cannot read properties of undefined", "Worker restarted"][(index * 3) % 5];
  return `03:27:${String(index % 60).padStart(2, "0")}.${String((index * 137) % 1000).padStart(3, "0")} [${level}] ${message}`;
});
const SPARKLES: [number, number, number][] = [[1040, 110, 0], [1150, 90, 0.35], [1120, 210, 0.7], [1250, 170, 0.2], [1000, 260, 0.9], [1330, 120, 0.55]];

type Cue = { id: string; at: number; play: (sound: OverviewSound) => void };
const SOUND_CUES: Cue[] = [
  { id: "whoosh", at: TIMELINE.act1End + 1.6, play: (sound) => sound.whoosh() },
  { id: "sparkle", at: TIMELINE.transitionEnd + 0.3, play: (sound) => sound.sparkle() },
  { id: "wow", at: TIMELINE.finaleStart + 0.8, play: (sound) => { sound.wow(); sound.sparkle(); } },
];

// Key clicks follow the revealed text but are capped, since the late beats
// reveal hundreds of characters a second.
const MAX_CLICKS_PER_SECOND = 30;

const fade = (t: number, start: number, end: number, ramp = 0.35) =>
  Math.max(0, Math.min(1, (t - start) / ramp, (end - t) / ramp));

export function ProjectOverview({ onClose, onTryDemo }: { onClose: () => void; onTryDemo: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const sound = useRef<OverviewSound | null>(null);
  const clock = useRef(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [viewport, setViewport] = useState({ width: 1280, height: 720 });
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    sound.current = createOverviewSound();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setViewport({ width: window.innerWidth, height: window.innerHeight }); setReducedMotion(media.matches); };
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
      const next = Math.min(TIMELINE.end, previous + Math.min(0.1, (now - last) / 1_000));
      last = now;
      clock.current = next;
      for (const cue of SOUND_CUES) if (previous < cue.at && next >= cue.at && sound.current) cue.play(sound.current);
      const typed = revealedChars(next) - revealedChars(previous);
      if (typed > 0 && next < TIMELINE.act1End && sound.current) {
        const dt = next - previous;
        const clicks = Math.min(typed, Math.max(1, Math.round(dt * MAX_CLICKS_PER_SECOND)));
        for (let index = 0; index < clicks; index++) sound.current.keyClick((dt * index) / clicks);
      }
      setT(next);
      if (next >= TIMELINE.end) { setPlaying(false); return; }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const seek = useCallback((time: number) => {
    clock.current = time;
    setT(time);
    setPlaying(time < TIMELINE.end);
  }, []);
  const toggleMuted = () => setMuted((current) => { sound.current?.setMuted(!current); return !current; });
  const togglePlaying = () => { if (clock.current >= TIMELINE.end) seek(0); else setPlaying((current) => !current); };

  const scene = sceneAt(t);
  const stage = stageAt(t);
  const camera = cameraAt(t, viewport.width / viewport.height);
  const scale = viewport.width / camera.w;
  const stageProgress = Math.min(1, Math.max(0, (t - stage.start) / stage.duration));
  const shaking = scene === "rant" && stage.id === "spiral" && !reducedMotion;
  const shake = shaking ? 7 * stageProgress : 0;
  const logScroll = (Math.min(t, LOG_RAIN.end) - LOG_RAIN.start) * 900;
  const logFly = Math.max(0, t - LOG_VANISH_AT);
  const blackout = scene === "transition" ? fade(t, TIMELINE.act1End - 0.35, TIMELINE.transitionEnd - 0.2, 0.3) : 0;
  const flash = Math.max(0, 1 - Math.abs(t - (TIMELINE.transitionEnd - 0.1)) / 0.45);
  const finaleT = t - TIMELINE.finaleStart;

  return createPortal(
    <div ref={dialog} className={styles.overlay} role="dialog" aria-modal="true" aria-label="프로젝트 개요" tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        else if (event.key === " ") togglePlaying();
        else if (event.key === "ArrowRight") seek(nextSceneTime(clock.current));
        else return;
        event.preventDefault();
      }}>
      <div className={styles.frame} data-scene={scene} data-stage={scene === "rant" ? stage.id : undefined}
        style={{ transform: shake ? `translate(${Math.sin(t * 47) * shake}px, ${Math.cos(t * 53) * shake}px)` : undefined }}>
        <div className={styles.art} style={{
          width: ART.width, height: ART.height,
          transform: `translate(${viewport.width * camera.ax}px, ${viewport.height / 2}px) scale(${scale}) translate(${-camera.cx}px, ${-camera.cy}px)`,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ART_SRC} alt="" width={ART.width} height={ART.height} draggable={false} />
          {/* The artwork misspells the product name; cover both spots. */}
          <span className={styles.badgeFix}>방금그거뭐였지</span>
          <span className={styles.monitorFix}>방금그거뭐였지</span>
          {(scene === "relief" || scene === "finale") && SPARKLES.map(([x, y, delay]) =>
            <i key={`${x}-${y}`} className={styles.sparkle} style={{ left: x, top: y, animationDelay: `${delay}s` }} />)}
        </div>
        <div className={styles.grade} />

        {scene === "rant" && <>
          {t >= LOG_RAIN.start && logFly < 1 && <pre className={styles.logRain} aria-hidden="true"
            style={{ transform: `translateY(${-logScroll - logFly * 1400}px)`, opacity: 1 - logFly }}>
            {Array.from({ length: 6 }, () => LOG_LINES.join("\n")).join("\n")}
          </pre>}
          {FLASH_CUES.map((at, index) => t >= at && t < at + 0.45 && <div key={at} className={styles.errorFlash}
            style={{ left: `${FLASH_SPOTS[index % FLASH_SPOTS.length][0]}%`, top: `${FLASH_SPOTS[index % FLASH_SPOTS.length][1]}%` }} aria-hidden="true">
            <b><i />Error</b><p><span>×</span>Something went wrong!</p><em>OK</em>
          </div>)}
          <div className={styles.toasts} aria-hidden="true">
            {TOAST_CUES.filter((cue) => t >= cue.at && t < cue.at + 1.7).map((cue) => <div key={cue.phrase} className={styles.toast}>⚠ {cue.text}</div>)}
          </div>
          <div className={styles.rant}>
            <p>{RANT.slice(0, revealedChars(t))}<span className={styles.caret} /></p>
          </div>
        </>}

        <div className={styles.blackout} style={{ opacity: blackout }}>
          <p style={{ opacity: fade(t, TIMELINE.act1End + 0.3, TIMELINE.transitionEnd, 0.4) }}>그래서,</p>
          <p style={{ opacity: fade(t, TIMELINE.act1End + 1, TIMELINE.transitionEnd, 0.4) }}>이 사람에게</p>
          <p className={styles.gift} style={{
            opacity: fade(t, TIMELINE.act1End + 1.7, TIMELINE.transitionEnd, 0.3),
            transform: `scale(${1 + 0.25 * Math.max(0, 1 - (t - TIMELINE.act1End - 1.7) / 0.3)})`,
          }}><span className={styles.brand}><i><ArrowCounterClockwise size={18} weight="bold" /></i>방금그거뭐였지</span>
            <span style={{ opacity: fade(t, TIMELINE.act1End + 2.5, TIMELINE.transitionEnd, 0.3) }}>를 줬더니</span></p>
        </div>
        <div className={styles.flash} style={{ opacity: flash }} />

        {scene === "relief" && <div className={styles.caption}>
          {[
            ["흘려보낸 그 화면, 이미 기록돼 있었다", 0.5, 3.2],
            ["최근 화면을 그대로 AI에게 건네면", 3.4, 5.8],
          ].map(([text, start, end]) => {
            const opacity = fade(t, TIMELINE.transitionEnd + Number(start), TIMELINE.transitionEnd + Number(end));
            return opacity > 0 && <p key={String(text)} style={{ opacity }}>{text}</p>;
          })}
        </div>}

        {scene === "finale" && <div className={styles.finale}>
          <p className={styles.wow} style={{ opacity: fade(finaleT, 0.8, 99, 0.2), transform: `scale(${1 + 0.4 * Math.max(0, 1 - (finaleT - 0.8) / 0.25)})` }}>wow~</p>
          <p className={styles.tagline} style={{ opacity: fade(finaleT, 1.4, 99, 0.5) }}>사라지는 화면도, 이제 놓치지 않아요.</p>
          {finaleT > 2 && <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onTryDemo}>30초 체험하기 <ArrowRight size={16} weight="bold" /></button>
            <button type="button" onClick={() => seek(0)}><ArrowCounterClockwise size={15} /> 다시 보기</button>
            <button type="button" onClick={onClose}>닫기</button>
          </div>}
        </div>}
      </div>

      <div className={styles.controls}>
        <button type="button" onClick={toggleMuted} aria-label={muted ? "소리 켜기" : "소리 끄기"}>{muted ? <SpeakerSlash size={16} /> : <SpeakerHigh size={16} />}</button>
        <button type="button" onClick={togglePlaying} aria-label={playing ? "일시정지" : "재생"}>{playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}</button>
        {scene !== "finale" && <button type="button" onClick={() => seek(nextSceneTime(clock.current))}><SkipForward size={16} weight="fill" /> 건너뛰기</button>}
        <button type="button" onClick={onClose} aria-label="개요 닫기"><X size={16} weight="bold" /></button>
      </div>
      <div className={styles.progress} aria-hidden="true"><span style={{ width: `${(t / TIMELINE.end) * 100}%` }} /></div>
    </div>,
    document.body,
  );
}
