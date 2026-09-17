"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowCounterClockwise, ArrowUp, Check, CircleNotch, Copy, FolderOpen, LinkSimple, Pause, Play, X } from "@phosphor-icons/react";
import { CHAT, CHAT_INPUT, COPY_BUTTON, DURATION, EXPORT_BUTTON, FOLDER_BUTTON, PAY_BUTTON, PIP, PIP_BAR, QUICK_STAGE, SEND, STEPS, STEP_STARTS, STRIP, TIMES, WORK, pointerFor, quickButton, slideAt, stepAt } from "@/lib/mode-quick-guide";
import type { QuickMode } from "@/lib/mode-quick-guide";
import { Pointer } from "./usage-examples/shared";
import styles from "./mode-quick-guide.module.css";

// The lobby's 10-second "how to use" clip for one delivery mode, opened from
// the mode guide. It plays once in a full-screen overlay with the three steps
// under the stage.

type Rect = { x: number; y: number; width: number; height: number };
const box = (rect: Rect, origin = { x: 0, y: 0 }): CSSProperties => ({ left: rect.x - origin.x, top: rect.y - origin.y, width: rect.width, height: rect.height });
const MODE_LABELS: [QuickMode, string][] = [["manual", "Manual"], ["link", "Agent Link"], ["folder", "Local Folder"]];
const NAMES: Record<QuickMode, string> = { manual: "Manual", link: "Agent Link", folder: "Local Folder" };
const QUESTION: Record<QuickMode, string> = {
  manual: "이 명령어 뭐였지? 그대로 알려줘",
  link: "이 링크의 최근 화면을 보고 방금 결제가 왜 실패했는지 알려줘 https://whatwas.vercel.app/a/x7k2",
  folder: "C:\\ai-context\\Context-0917-1432 폴더를 읽고 빌드가 왜 깨졌는지 알려줘",
};
const ANSWER: Record<QuickMode, string> = {
  manual: "npm create vite@latest my-app -- --template react 입니다. 3번째 슬라이드에 있던 명령어예요.",
  link: "결제하기를 누른 직후 POST /api/pay 가 500으로 실패했어요. 오류 알림이 1초만 떠서 놓치셨네요.",
  folder: "빌드 직전에 vite.config.ts 에 './env' import 를 추가했는데 그 파일이 없어요.",
};

export function ModeQuickGuide({ mode, onClose }: { mode: QuickMode; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const clock = useRef(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("resize", update); document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const next = Math.min(DURATION, clock.current + Math.min(0.1, (now - last) / 1_000));
      last = now;
      clock.current = next;
      setT(next);
      if (next >= DURATION) { setPlaying(false); return; }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const seek = (at: number) => { clock.current = at; setT(at); setPlaying(true); };
  const togglePlaying = () => { if (clock.current >= DURATION) seek(0); else setPlaying((value) => !value); };
  const current = stepAt(t);
  const ended = t >= DURATION;
  const scale = Math.min((viewport.width - 32) / QUICK_STAGE.width, (viewport.height - 64 - 110) / QUICK_STAGE.height);

  return createPortal(
    <div ref={dialog} className={`${styles.overlay} theme-fixed`} role="dialog" aria-modal="true" aria-label={`${NAMES[mode]} 10초 사용법`} tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        else if (event.key === " ") togglePlaying();
        else return;
        event.preventDefault();
      }}>
      <header className={styles.topBar}>
        <strong><b>{NAMES[mode]}</b> 10초 사용법</strong>
        <div className={styles.controls}>
          <button type="button" onClick={togglePlaying} aria-label={playing ? "일시정지" : "재생"}>{playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}</button>
          <button type="button" onClick={() => seek(0)} aria-label="처음부터"><ArrowCounterClockwise size={16} /></button>
          <button type="button" onClick={onClose} aria-label="사용법 닫기"><X size={16} weight="bold" /></button>
        </div>
      </header>
      <div className={styles.stageArea}>
        <div className={styles.stageBox} style={{ width: QUICK_STAGE.width * scale, height: QUICK_STAGE.height * scale }}>
          <div className={styles.stage} aria-hidden="true" style={{ width: QUICK_STAGE.width, height: QUICK_STAGE.height, transform: `scale(${scale})` }}>
            <Scene mode={mode} t={t} />
          </div>
          {ended && <div className={styles.endCard}>
            <strong>{NAMES[mode]}, 이렇게 세 번이면 끝</strong>
            <div>
              <button type="button" className={styles.primary} onClick={() => seek(0)}><ArrowCounterClockwise size={16} /> 다시 보기</button>
              <button type="button" onClick={onClose}>닫기</button>
            </div>
          </div>}
        </div>
        <ol className={styles.steps} style={{ width: QUICK_STAGE.width * scale }}>
          {STEPS[mode].map((text, index) => <li key={text} data-active={index === current && !ended} data-done={index < current || ended}>
            <button type="button" onClick={() => seek(STEP_STARTS[index])}><b>{index + 1}</b>{text}</button>
          </li>)}
        </ol>
      </div>
      <div className={styles.progress} aria-hidden="true"><span style={{ width: `${(t / DURATION) * 100}%` }} /></div>
    </div>,
    document.body,
  );
}

function Scene({ mode, t }: { mode: QuickMode; t: number }) {
  const times = TIMES[mode];
  const pointer = pointerFor(mode, t);
  const open = t >= times.open;
  const exporting = times.export && t >= times.export[0] && t < times.export[1];
  const exported = times.export && t >= times.export[1];
  const copied = t >= (times.copied ?? Infinity);
  const sent = t >= times.send;
  const dropped = t >= (times.drop ?? Infinity);
  const dragging = mode === "manual" && t >= 5.0 && !dropped;
  const pasted = t >= (times.paste ?? Infinity);
  const keys = mode === "folder" && t < 0.5 ? <><kbd>Ctrl</kbd>+<kbd>S</kbd></>
    : mode === "manual" ? null
    : t >= 5.45 && t < 6.2 ? <><kbd>Ctrl</kbd>+<kbd>V</kbd></>
    : mode === "folder" && t >= 6.2 && t < 6.8 ? <kbd>Enter</kbd> : null;
  const inputText = sent ? "" : mode === "manual" ? (dropped ? QUESTION.manual : "") : pasted ? QUESTION[mode] : "";

  return <>
    {mode === "manual" && <LectureWindow slide={slideAt(t)} />}
    {mode === "link" && <CheckoutWindow t={t} />}
    {mode === "folder" && <EditorWindow t={t} />}
    {!open && <section className={styles.pipBar} style={box(PIP_BAR)}>
      <i className={styles.rec} />기록 중
      {MODE_LABELS.map(([id], index) => { const at = quickButton(index); return <span key={id} className={styles.quick} data-pressed={id === mode && t >= times.open - 0.5}
        style={{ left: at.x - PIP_BAR.x - 10, top: at.y - PIP_BAR.y - 10 }}>{index + 1}</span>; })}
    </section>}
    {open && <section className={styles.pip} style={box(PIP)}>
      <header>whatwas.vercel.app</header>
      <div className={styles.pipModes}>{MODE_LABELS.map(([id, label]) => <span key={id} data-active={id === mode}>{label}</span>)}<em><i className={styles.rec} />기록 중</em></div>
      {mode === "manual" && <ManualStrip t={t} />}
      {mode === "link" && <p className={styles.row} style={{ top: 66 }}>링크 유지 <span className={styles.select}>20분 ▾</span><small>20분이 지나면 자동으로 삭제됩니다.</small></p>}
      {mode === "folder" && <>
        <p className={styles.row} style={{ top: 68 }}>{t >= (times.folder ?? Infinity) ? "저장 위치: …/ai-context" : "저장 위치를 선택해 주세요."}</p>
        <span className={styles.smallButton} style={box(FOLDER_BUTTON, PIP)} data-pressed={t >= 2.35 && t < 2.55}><FolderOpen size={11} />폴더 선택</span>
      </>}
      {mode !== "manual" && <>
        <span className={styles.exportButton} style={box(EXPORT_BUTTON, PIP)} data-pressed={Boolean(exporting)}>
          {exporting ? <CircleNotch className={styles.spin} size={14} /> : mode === "link" ? <LinkSimple size={14} /> : <FolderOpen size={14} />}AI Context 생성
        </span>
        {exported && <>
          <p className={styles.success} style={{ top: 140 }}><Check size={12} weight="bold" />{mode === "link" ? "링크 준비됨 · 14:52 만료" : "Context-0917-1432 저장됨"}</p>
          <p className={styles.promptBox} style={{ top: 158 }}>{QUESTION[mode]}</p>
          <span className={styles.copyButton} style={box(COPY_BUTTON, PIP)} data-done={copied}>
            {copied ? <><Check size={12} />복사되었습니다</> : <><Copy size={12} />프롬프트 복사</>}
          </span>
        </>}
      </>}
    </section>}
    <Chat mode={mode} t={t} inputText={inputText} attached={mode === "manual" && dropped && !sent} dropping={dragging && pointer.x > CHAT.x} />
    {dragging && <span className={styles.ghost} style={{ left: pointer.x, top: pointer.y }}><SlideThumb slide={2} width={64} /></span>}
    {keys && <div className={styles.keycaps} style={{ left: t < 1 ? WORK.x + WORK.width / 2 : CHAT.x + CHAT.width / 2 }}>{keys}</div>}
    <Pointer {...pointer} />
  </>;
}

// Manual: an online lecture whose slides move on before you can copy them.
const SLIDES: { title: string; body: ReactNode }[] = [
  { title: "7강 · 개발 환경 만들기", body: <ul><li>Node.js 20 이상 설치</li><li>에디터: VS Code</li><li>패키지 매니저: npm</li></ul> },
  { title: "Node 버전 확인", body: <pre>$ node -v{"\n"}v20.11.1</pre> },
  { title: "프로젝트 생성", body: <pre>$ npm create vite@latest my-app{"\n"}    -- --template react{"\n"}$ cd my-app && npm install</pre> },
  { title: "폴더 구조", body: <pre>my-app/{"\n"}├─ src/{"\n"}│  └─ App.jsx{"\n"}└─ package.json</pre> },
  { title: "개발 서버 실행", body: <pre>$ npm run dev{"\n"}  ➜ Local: http://localhost:5173</pre> },
];
// Slide size inside the lecture window; thumbnails scale this down.
const SLIDE_WIDTH = 348;

function Slide({ slide }: { slide: number }) {
  const { title, body } = SLIDES[slide];
  return <div className={styles.slide} style={{ width: SLIDE_WIDTH }}><b>{title}</b>{body}<small>{slide + 1} / {SLIDES.length}</small></div>;
}

function SlideThumb({ slide, width = STRIP.frame }: { slide: number; width?: number }) {
  return <span className={styles.thumb}><span style={{ transform: `scale(${width / SLIDE_WIDTH})` }}><Slide slide={slide} /></span></span>;
}

function LectureWindow({ slide }: { slide: number }) {
  return <section className={styles.browser} style={box(WORK)}>
    <header><i /><i /><i /><span>class.example.com · React 입문 7강</span></header>
    <div className={styles.lecture}>
      <Slide slide={slide} />
      <p className={styles.lectureBar}><i style={{ width: `${34 + slide * 4}%` }} /><span>12:4{slide} / 38:10</span></p>
    </div>
  </section>;
}

function ManualStrip({ t }: { t: number }) {
  const times = TIMES.manual;
  const expanded = t >= (times.expand ?? Infinity);
  const picked = t >= (times.pick ?? Infinity);
  // Representative slides 1, 2, 4, 5; the gap hides slide 3 (the command).
  const items: { kind: "frame" | "middle" | "gap"; slide: number }[] = expanded
    ? [{ kind: "frame", slide: 0 }, { kind: "frame", slide: 1 }, { kind: "middle", slide: 2 }, { kind: "middle", slide: 2 }, { kind: "frame", slide: 3 }, { kind: "frame", slide: 4 }]
    : [{ kind: "frame", slide: 0 }, { kind: "frame", slide: 1 }, { kind: "gap", slide: 2 }, { kind: "frame", slide: 3 }, { kind: "frame", slide: 4 }];
  let x = 0;
  return <>
    <p className={styles.row} style={{ top: 58, color: "#a7a99f", fontSize: 10 }}>최근 30초 · 대표 화면</p>
    {items.map((item, index) => {
      const width = item.kind === "gap" ? STRIP.gap : STRIP.frame;
      const left = x; x += width + STRIP.spacing;
      const style = { left: STRIP.left - PIP.x + left, top: STRIP.top - PIP.y, width, height: STRIP.height };
      return item.kind === "gap"
        ? <span key={`gap-${index}`} className={styles.gap} data-pressed={t >= 2.9 && t < 3.05} style={style}>…</span>
        : <span key={`${item.kind}-${index}`} className={styles.frame} data-middle={item.kind === "middle"} data-picked={picked && index === 2} style={style}>
          <SlideThumb slide={item.slide} />
        </span>;
    })}
    <p className={styles.note} style={{ top: 140 }}>{picked ? "선택 1장 · AI 입력창에 끌어다 놓으세요" : "… 를 누르면 사이 화면이 원본 해상도로 펼쳐져요"}</p>
    <span className={styles.exportButton} style={{ ...box(EXPORT_BUTTON, PIP), top: 164 }} data-disabled={!picked}>선택한 화면 저장</span>
  </>;
}

// Agent Link: a checkout page whose error toast is gone in a second.
function CheckoutWindow({ t }: { t: number }) {
  const paying = t >= 0.5 && t < 0.8;
  return <section className={styles.browser} style={box(WORK)}>
    <header><i /><i /><i /><span>shop.example.com/checkout</span></header>
    <div className={styles.checkout}>
      <b>주문/결제</b>
      <div className={styles.orderItem}><span className={styles.product} /><p>무선 키보드 K3<small>수량 1개</small></p><strong>39,000원</strong></div>
      <p className={styles.orderRow}><span>배송비</span><span>무료</span></p>
      <p className={styles.orderRow}><span>결제 수단</span><span>신용카드 ▾</span></p>
      <p className={styles.orderTotal}><span>총 결제금액</span><strong>39,000원</strong></p>
      <span className={styles.payButton} style={box(PAY_BUTTON, { x: WORK.x, y: WORK.y + 24 })} data-busy={paying}>{paying ? "결제 중…" : "39,000원 결제하기"}</span>
      {t >= 0.8 && t < 1.8 && <p className={styles.toast}>결제 요청에 실패했습니다 (500)</p>}
    </div>
  </section>;
}

// Local Folder: an editor whose build breaks right after a save.
function EditorWindow({ t }: { t: number }) {
  const failed = t >= 1.0;
  return <section className={styles.editor} style={box(WORK)}>
    <header><i /><i /><i /><span>my-app — Visual Studio Code</span></header>
    <div className={styles.editorTabs}><span data-active="true">vite.config.ts{t < 0.3 ? " ●" : ""}</span><span>App.tsx</span></div>
    <pre className={styles.code}>
      <span><i>1</i><em>import</em> {"{ defineConfig }"} <em>from</em> <q>vite</q></span>
      <span><i>2</i><em>import</em> react <em>from</em> <q>@vitejs/plugin-react</q></span>
      <span data-new="true"><i>3</i><em>import</em> {"{ env }"} <em>from</em> <q>./env</q></span>
      <span><i>4</i><em>export default</em> defineConfig({"{"}</span>
      <span><i>5</i>  plugins: [react()],</span>
      <span><i>6</i>  define: {"{"} API_URL: env.API_URL {"}"},</span>
    </pre>
    <div className={styles.terminal}>
      <small>TERMINAL</small>
      <p>$ npm run build</p>
      {failed && <p data-error="true">error TS2307: Cannot find module &apos;./env&apos;</p>}
      {failed && <p data-error="true">✗ Build failed in 1.2s</p>}
    </div>
  </section>;
}

function Chat({ mode, t, inputText, attached, dropping }: { mode: QuickMode; t: number; inputText: string; attached: boolean; dropping: boolean }) {
  const times = TIMES[mode];
  const sent = t >= times.send;
  const terminal = mode === "folder";
  const linkWorking = mode === "link" && t >= times.work[0][0] && t < times.work[0][1];
  const tools = mode === "folder" ? ["Read context.md", "Read events.json", "Read frames/ (6장)"].filter((_, index) => t >= times.work[index][0]) : [];
  return <section className={styles.chat} data-terminal={terminal} style={box(CHAT)}>
    <header>{terminal ? "로컬 에이전트 · ~/my-app" : "AI 채팅"}</header>
    <div className={styles.messages}>
      {sent && <div className={styles.user}>
        {mode === "manual" && <span className={styles.userImage}><SlideThumb slide={2} width={90} /></span>}
        <p>{QUESTION[mode]}</p>
      </div>}
      {mode === "link" && t >= times.work[0][0] && <div className={styles.ai}><code>{linkWorking ? "링크 여는 중…" : "화면 8장 · 변화 기록 확인"}</code></div>}
      {tools.map((tool) => <div key={tool} className={styles.ai}><code>{tool}</code></div>)}
      {mode === "manual" && sent && t < times.answer && <div className={styles.ai}><p className={styles.thinking}>생각하는 중…</p></div>}
      {t >= times.answer && <div className={styles.ai}><p>{ANSWER[mode]}</p></div>}
    </div>
    <div className={styles.input} style={box(CHAT_INPUT, CHAT)} data-dropping={dropping}>
      {attached && <span className={styles.attachment}><SlideThumb slide={2} width={44} /></span>}
      <span className={styles.inputText} data-empty={!inputText}>{inputText || (terminal ? "> " : "메시지 보내기")}</span>
      {!terminal && <span className={styles.send} style={{ left: SEND.x - CHAT_INPUT.x - 12, top: SEND.y - CHAT_INPUT.y - 12 }}><ArrowUp size={12} weight="bold" /></span>}
    </div>
  </section>;
}
