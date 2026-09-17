import type { CSSProperties, ReactNode } from "react";
import { ArrowUp, CornersOut, Paperclip, Stop } from "@phosphor-icons/react";
import { CHAT, CHAT_INPUT, SEND_BUTTON } from "@/lib/usage-example-timeline";
import type { Caption as CaptionData } from "@/lib/usage-example-timeline";
import styles from "./usage-examples.module.css";

// Pieces every usage example draws the same way: the Claudy chat, the
// pointer, captions, key presses, and the AI stick-figure cards.

export const box = (rect: { x: number; y: number; width: number; height: number }, origin = { x: 0, y: 0 }): CSSProperties =>
  ({ left: rect.x - origin.x, top: rect.y - origin.y, width: rect.width, height: rect.height });

export function ClaudyLogo({ size = 22 }: { size?: number }) {
  return <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
    <path d="M9 25 C4 25 2 21.5 3.5 18.5 C2 14 6 11 9.5 12 C10.5 7.5 15 5.5 19 7.5 C22 5.8 27 8 26.5 12.5 C30 13.5 30.5 18 28.5 20.5 C29 23.5 26.5 25 24 25 Z" fill="#d9784f" />
    <circle cx="12.5" cy="17.5" r="1.7" fill="#fff" /><circle cx="19.5" cy="17.5" r="1.7" fill="#fff" />
    <path d="M13.5 21 q2.5 2 5 0" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" />
  </svg>;
}

export type ChatItem =
  | { id: string; role: "user"; text: string; images: ReactNode[] }
  | { id: string; role: "claudy"; text: string; thinking: boolean; tools: string[]; done: string; evidence?: ReactNode };

export function ClaudyChat({ project, messages, input, dropping = false }: {
  project: string; messages: ChatItem[]; dropping?: boolean;
  input: { text: string; attachments: ReactNode[]; typing: boolean };
}) {
  const shownAttachments = input.attachments.slice(0, 4);
  const extra = input.attachments.length - shownAttachments.length;
  return <section className={styles.claudy} style={box(CHAT)} aria-label="Claudy 대화">
    <header><ClaudyLogo /><b>Claudy</b><small>코딩 에이전트 · {project}</small></header>
    <div className={styles.messages} style={{ height: CHAT_INPUT.y - CHAT.y - 64 }}>
      {messages.length === 0 && <p className={styles.welcome}><ClaudyLogo size={40} />무엇을 도와드릴까요?</p>}
      {messages.map((message) => message.role === "user"
        ? <div key={message.id} className={styles.userMessage}>
          {message.images.length > 0 && <div className={styles.messageImages} data-many={message.images.length > 1}>
            {message.images.map((image, index) => <span key={index} className={styles.messageImage}>{image}</span>)}
          </div>}
          <p>{message.text}</p>
        </div>
        : <div key={message.id} className={styles.claudyMessage}>
          <ClaudyLogo size={20} />
          <div>
            {message.thinking ? <p className={styles.thinking}>생각하는 중<i /><i /><i /></p> : <p>{message.text}</p>}
            {message.evidence && <span className={styles.evidence}>{message.evidence}</span>}
            {message.tools.map((tool) => <code key={tool}>{tool}</code>)}
            {message.done && <p>{message.done}</p>}
          </div>
        </div>)}
    </div>
    <div className={styles.chatInput} style={box(CHAT_INPUT, CHAT)} data-dropping={dropping}>
      {shownAttachments.map((attachment, index) => <span key={index} className={styles.attachment}>{attachment}</span>)}
      {extra > 0 && <span className={styles.attachmentMore}>+{extra}</span>}
      <span className={styles.inputText} data-empty={!input.text}>{input.text || "Claudy에게 메시지 보내기"}{input.typing && <i className={styles.caret} />}</span>
      <Paperclip className={styles.clip} size={16} />
      <span className={styles.send} style={{ left: SEND_BUTTON.x - CHAT_INPUT.x - 16, top: SEND_BUTTON.y - CHAT_INPUT.y - 16 }}><ArrowUp size={16} weight="bold" /></span>
    </div>
  </section>;
}

export function Pointer({ x, y, pressed, clickAge, crosshair = false }: { x: number; y: number; pressed: boolean; clickAge: number | null; crosshair?: boolean }) {
  return <div className={styles.cursor} style={{ left: x, top: y }} data-pressed={pressed} data-crosshair={crosshair}>
    {clickAge !== null && <i style={{ transform: `translate(-50%, -50%) scale(${0.4 + clickAge * 3})`, opacity: 1 - clickAge / 0.45 }} />}
    {crosshair
      ? <svg viewBox="0 0 24 24" width="28" height="28"><path d="M12 1 V23 M1 12 H23" stroke="#fff" strokeWidth="3" /><path d="M12 1 V23 M1 12 H23" stroke="#111" strokeWidth="1.2" /></svg>
      : <svg viewBox="0 0 24 24" width="28" height="28"><path d="M3 2 L3 20 L8 15 L11.5 22 L14.5 20.6 L11 13.8 L18 13.8 Z" fill="#fff" stroke="#111" strokeWidth="1.6" strokeLinejoin="round" /></svg>}
  </div>;
}

export function Caption({ caption }: { caption: CaptionData | null }) {
  return caption && <p key={caption.text} className={styles.caption}>{caption.text}</p>;
}

export function Keycaps({ children }: { children: ReactNode }) {
  return <div className={styles.keycaps}>{children}</div>;
}

export function ShutterFlash({ opacity }: { opacity: number }) {
  return opacity > 0 && <div className={styles.shutterFlash} style={{ opacity }} />;
}

// The AI as a stick figure on a white card: "dumb" is the blank stare,
// "smart" the glasses-and-sparkle version.
export function StickCard({ kind, x, y, children }: { kind: "dumb" | "smart"; x: number; y: number; children?: ReactNode }) {
  return <figure className={styles.stickCard} data-kind={kind} style={{ left: x, top: y }}>
    <b>AI</b>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={kind === "smart" ? "/overview/ai-smart-stick-figure.webp" : "/overview/ai-stick-figure.webp"} alt={kind === "smart" ? "똑똑해진 AI" : "헤매는 AI"} />
    {children}
  </figure>;
}

type Mode = "Manual" | "Agent Link" | "Local Folder";
const MODES: [Mode, string][] = [["Manual", "화면 직접 선택"], ["Agent Link", "URL 하나 전달"], ["Local Folder", "로컬 Agent가 검색"]];

// The 방금그거뭐였지 PiP chrome, mirroring the real export panel: title bar,
// recording status and the three delivery modes. `minimized` shows the bar.
// The minimized bar's 1·2·3 buttons open the modes in MODES order;
// `pressedQuick` is the index of the one being clicked.
export function PipFrame({ rect, mode, minimized = false, pressedQuick = null, children }: {
  rect: { x: number; y: number; width: number; height: number }; mode: Mode | null; minimized?: boolean; pressedQuick?: number | null; children?: ReactNode;
}) {
  if (minimized) return <section className={styles.pip} data-minimized="true" style={{ left: rect.x, top: rect.y + rect.height - 78, width: 360, height: 78 }} aria-label="방금그거뭐였지 작은 창">
    <header>whatwas.vercel.app</header>
    <div className={styles.pipBar}><span className={styles.recDot} />화면 기록 중<em><Stop size={9} weight="fill" /> 중지</em>
      <span className={styles.quickModes}>{MODES.map(([label], index) => <i key={label} title={label} data-pressed={index === pressedQuick}>{index + 1}</i>)}</span>
      <CornersOut size={13} /></div>
  </section>;
  return <section className={styles.pip} style={box(rect)} aria-label="방금그거뭐였지 작은 창">
    <header>whatwas.vercel.app</header>
    <div className={styles.pipStatus}><span className={styles.recDot} />화면 기록 중 <em><Stop size={9} weight="fill" /> 중지</em></div>
    {MODES.map(([label, detail], index) => <span key={label} className={styles.modeButton} data-pressed={label === mode} style={{ left: 16 + index * 180, top: 44 }}>
      <b>{label}</b><small>{detail}</small>
    </span>)}
    {children}
  </section>;
}
