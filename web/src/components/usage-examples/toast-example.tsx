import type { ReactNode } from "react";
import { ArrowClockwise, ArrowLeft, ArrowRight, Camera, Check, CheckCircle, CircleNotch, Clock, Copy, DownloadSimple, Files, GitBranch, LinkSimple, MagnifyingGlass, Minus, Square, TerminalWindow, X } from "@phosphor-icons/react";
import * as toast from "@/lib/usage-example-toast";
import { Caption, ClaudyChat, Keycaps, PipFrame, Pointer, ShutterFlash, StickCard, box } from "./shared";
import type { ChatItem } from "./shared";
import styles from "./toast-example.module.css";

// Example: "안 눌리는 버튼". The browser keeps DevTools docked once opened;
// the editor takes the work area on Alt+Tab.

// Tiny screenshots the developer pastes, and the frame the AI points at.
function Thumb({ shot, evidence = false }: { shot: toast.Shot | "evidence"; evidence?: boolean }) {
  const body: Record<toast.Shot | "evidence", ReactNode> = {
    page: <>
      <rect x="8" y="10" width="60" height="6" rx="1" fill="#1f2328" />
      {[24, 34, 44].map((y) => <rect key={y} x="8" y={y} width="120" height="6" rx="1" fill="#e3e6ea" />)}
      <rect x="8" y="58" width="30" height="10" rx="2" fill="#1a73e8" /><rect x="162" y="58" width="30" height="10" rx="2" fill="#1f2328" />
      <rect x="0" y="76" width="200" height="49" fill="#202124" />
    </>,
    console: <>
      <rect x="0" y="0" width="200" height="125" fill="#202124" /><rect width="200" height="14" fill="#292a2d" />
      <text x="8" y="10" fill="#9aa0a6" fontSize="7">Elements</text><text x="48" y="10" fill="#8ab4f8" fontSize="7">Console</text>
      <text x="10" y="30" fill="#9aa0a6" fontSize="7" fontStyle="italic">콘솔 메시지 없음</text>
    </>,
    network: <>
      <rect x="0" y="0" width="200" height="125" fill="#202124" /><rect width="200" height="14" fill="#292a2d" />
      <text x="8" y="10" fill="#9aa0a6" fontSize="7">Console</text><text x="48" y="10" fill="#8ab4f8" fontSize="7">Network</text>
      <text x="62" y="68" fill="#9aa0a6" fontSize="8">요청 0건</text>
    </>,
    code: <>
      <rect x="0" y="0" width="200" height="125" fill="#1e1e1e" />
      {toast.EXPORT_BUTTON_CODE.map((line, index) => <text key={index} x="8" y={16 + index * 13} fill={index === 5 ? "#ce9178" : "#d4d4d4"} fontSize="6.5" fontFamily="monospace">{line}</text>)}
    </>,
    evidence: <>
      <rect x="8" y="10" width="60" height="6" rx="1" fill="#1f2328" />
      {[24, 34, 44].map((y) => <rect key={y} x="8" y={y} width="120" height="6" rx="1" fill="#e3e6ea" />)}
      <rect x="8" y="58" width="30" height="10" rx="2" fill="#1a73e8" /><rect x="162" y="58" width="30" height="10" rx="2" fill="#1f2328" />
      <rect x="118" y="52" width="78" height="22" rx="4" fill="#1f2328" /><text x="126" y="66" fill="#fff" fontSize="7">✓ 저장되었습니다</text>
      {evidence && <rect x="114" y="48" width="86" height="30" rx="5" fill="none" stroke="#ff6b22" strokeWidth="2.5" />}
      <rect x="0" y="82" width="200" height="43" fill="#202124" />
    </>,
  };
  return <svg viewBox="0 0 200 125" aria-hidden="true"><rect width="200" height="125" fill="#fff" />{body[shot]}</svg>;
}

export function ToastExample({ t }: { t: number }) {
  const app = toast.appAt(t);
  const pip = toast.pipAt(t);
  const card = toast.cardAt(t);
  const input = toast.chatInputAt(t);
  const keys = toast.keysAt(t);
  const capture = toast.captureAt(t);
  const messages: ChatItem[] = toast.chatAt(t).map((message) => message.role === "user"
    ? { id: message.id, role: "user", text: message.text, images: message.shot ? [<Thumb key="shot" shot={message.shot} />] : [] }
    : { ...message, evidence: message.evidence ? <><Thumb shot="evidence" evidence /><small>03:12:02 · 저장 직후</small></> : undefined });
  return <>
    {capture.hud && <p className={styles.hud}><span><Camera size={15} weight="fill" />캡처 {capture.pasted}장</span><span><Clock size={15} weight="fill" />{capture.minutes}분째</span></p>}
    <section className={styles.work} style={box(toast.WORK)} aria-label={app === "editor" ? "코드 에디터" : "브라우저"}>
      {app === "editor" ? <Editor state={toast.editorAt(t)} /> : <Browser state={toast.browserAt(t)} />}
    </section>

    <ClaudyChat project="acme-admin" messages={messages}
      input={{ text: input.text, typing: input.typing, attachments: input.shot ? [<Thumb key="shot" shot={input.shot} />] : [] }} />

    {card && <StickCard kind={card} x={600} y={card === "smart" ? 372 : 330}>
      {card === "dumb" && <span className={styles.cardNote}>제 환경에선 되는데요? 🙂</span>}
    </StickCard>}
    {pip.visible && <LinkPip pip={pip} />}

    <ShutterFlash opacity={capture.flash} />
    {keys && <Keycaps>{keys.keys.map((key, index) => <span key={key} className={styles.keyGroup}>{index > 0 && "+"}<kbd>{key}</kbd></span>)}{keys.note && <span>{keys.note}</span>}</Keycaps>}
    <Pointer {...toast.cursorAt(t)} />
    <Caption caption={toast.captionAt(t)} />
  </>;
}

function Browser({ state }: { state: toast.BrowserState }) {
  return <div className={styles.browser}>
    <header className={styles.browserTabs}><span>설정 · Acme Admin<X size={11} /></span><em><Minus size={13} /><Square size={11} /><X size={13} /></em></header>
    <div className={styles.addressBar}>
      <ArrowLeft size={15} /><ArrowRight size={15} /><ArrowClockwise size={15} />
      <span>localhost:3000/settings</span>
      {state.downloaded && <b className={styles.download}><DownloadSimple size={14} weight="bold" />users.csv</b>}
    </div>
    <div className={styles.page}>
      <h3>계정 설정</h3>
      <p className={styles.field}><span>팀 이름</span><em>Acme Growth</em></p>
      <p className={styles.field}><span>알림 메일</span><em>ops@acme.dev</em></p>
      <p className={styles.field}><span>데이터 보관</span><em>90일</em></p>
    </div>
    <span className={styles.button} data-kind="primary" style={{ left: toast.SAVE_BUTTON.x - toast.WORK.x - 60, top: toast.SAVE_BUTTON.y - toast.WORK.y - 17 }}>{state.saved ? "저장됨" : "저장"}</span>
    <span className={styles.button} style={{ left: toast.EXPORT_BUTTON.x - toast.WORK.x - 60, top: toast.EXPORT_BUTTON.y - toast.WORK.y - 17 }}><DownloadSimple size={14} />내보내기</span>
    {state.toastOpacity > 0 && <p className={styles.toast} style={{ ...box(toast.TOAST), opacity: state.toastOpacity }}><CheckCircle size={18} weight="fill" />저장되었습니다</p>}
    {state.devtools && <div className={styles.devtools} style={{ top: toast.DEVTOOLS_TOP - toast.WORK.y }}>
      <nav className={styles.devtoolsTabs}>
        <span>Elements</span>
        <span data-active={state.devtoolsTab === "console"}>Console</span>
        <span data-active={state.devtoolsTab === "network"}>Network</span>
        <span>Sources</span>
      </nav>
      {state.devtoolsTab === "console"
        ? <p className={styles.consoleEmpty}>콘솔 메시지 없음</p>
        : <div className={styles.network}>
          <p className={styles.networkHead}><span>Name</span><span>Status</span><span>Type</span><span>Time</span></p>
          {state.exportRequest
            ? <p><span>export?type=users</span><span>200</span><span>fetch</span><span>64 ms</span></p>
            : <p className={styles.networkEmpty}>기록된 요청 0건 · 버튼을 눌러도 요청이 없음</p>}
        </div>}
    </div>}
  </div>;
}

function Editor({ state }: { state: toast.EditorState }) {
  return <div className={styles.editor}>
    <header className={styles.editorTitle}><span>acme-admin — Visual Studio Code</span><em><Minus size={13} /><Square size={11} /><X size={13} /></em></header>
    <aside className={styles.activity}><Files size={22} weight="fill" /><MagnifyingGlass size={22} /><GitBranch size={22} data-active={state.active === "변경 사항"} /></aside>
    <nav className={styles.editorTabs}>
      {state.tabs.map((tab) => <span key={tab} data-active={tab === state.active}>{tab}<X size={10} /></span>)}
    </nav>
    {state.active === "변경 사항"
      ? <div className={styles.diff} aria-label="변경 사항">
        <b>소스 제어 · 변경 사항 {state.diffRows}</b>
        {toast.DIFF_ROWS.slice(0, state.diffRows).map((row, index) => <p key={index} data-kind={row.kind}>
          <small>{row.file}</small><code>{row.kind === "add" ? "+" : "−"} {row.text}</code>
        </p>)}
      </div>
      : <pre className={styles.code}>{toast.EXPORT_BUTTON_CODE.map((line, index) => <p key={index}><span>{index + 1}</span>{colorize(line)}</p>)}</pre>}
    <div className={styles.terminal}>
      <header><TerminalWindow size={13} />터미널<small>npm run dev</small></header>
      {state.terminal.map((line) => <p key={line} data-tone={line.startsWith("✓") ? "ok" : undefined}>{line}</p>)}
    </div>
  </div>;
}

const KEYWORDS = /^(export|function|const|async|await|return)$/;
function colorize(line: string) {
  return line.split(/(".*?"|\b(?:export|function|const|async|await|return)\b)/g).map((part, index) =>
    part.startsWith("\"") ? <em key={index} className={styles.string}>{part}</em>
      : KEYWORDS.test(part) ? <em key={index} className={styles.keyword}>{part}</em> : part);
}

function LinkPip({ pip }: { pip: toast.PipState }) {
  const origin = { x: toast.PIP.x, y: toast.PIP.y };
  return <PipFrame rect={toast.PIP} mode={pip.link ? "Agent Link" : null} minimized={pip.minimized} pressedQuick={pip.quickPressed ? 1 : null}>
    <p className={styles.pipRow} style={{ top: 104 }}><span>전송 구간 <b>최근 30초</b></span><span>링크 20분 유효</span></p>
    <span className={styles.exportButton} data-busy={pip.exporting} style={{ left: 16, right: 16, top: toast.PIP_EXPORT.y - origin.y - 18 }}>
      {pip.exporting ? <CircleNotch className={styles.spin} size={15} /> : <LinkSimple size={15} />}AI Context 생성
    </span>
    {pip.exported && <>
      <p className={styles.pipSuccess} style={{ top: 184 }}><Check size={13} weight="bold" />링크 준비됨 · 오전 03:32 만료</p>
      <p className={styles.pipSteps} style={{ top: 206 }}>이 프롬프트만 AI에 붙여넣으세요.</p>
      <p className={styles.pipPrompt} style={{ top: 228 }}>{toast.LINK_PROMPT}</p>
      <span className={styles.copyButton} data-copied={pip.copied} style={{ left: 16, right: 16, top: toast.COPY_BUTTON.y - origin.y - 18 }}>
        {pip.copied ? <Check size={14} /> : <Copy size={14} />}{pip.copied ? "복사되었습니다" : "프롬프트 복사"}
      </span>
    </>}
  </PipFrame>;
}
