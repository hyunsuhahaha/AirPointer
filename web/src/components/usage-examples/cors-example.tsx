import { ArrowClockwise, ArrowLeft, ArrowRight, Check, CircleNotch, Copy, Files, GitBranch, LinkSimple, MagnifyingGlass, Minus, Square, TerminalWindow, X } from "@phosphor-icons/react";
import * as cors from "@/lib/usage-example-cors";
import { Caption, ClaudyChat, Keycaps, PipFrame, Pointer, StickCard, box } from "./shared";
import type { ChatItem } from "./shared";
import styles from "./cors-example.module.css";

// Example: "CORS 아닌 CORS 에러". The editor and the browser share the work
// area and swap on Alt+Tab; the browser keeps DevTools docked at the bottom.

const USERS = [["김민지", "minji@acme.dev", "Admin"], ["박서준", "seojun@acme.dev", "Editor"], ["이하은", "haeun@acme.dev", "Viewer"], ["최도윤", "doyun@acme.dev", "Editor"]];

// The Network › Headers panel as a thumbnail: what the AI points at.
function HeadersThumb() {
  return <svg viewBox="0 0 200 125" aria-hidden="true">
    <rect width="200" height="125" fill="#202124" />
    <rect width="200" height="14" fill="#292a2d" />
    <text x="8" y="10" fill="#9aa0a6" fontSize="7">Elements  Console  </text><text x="78" y="10" fill="#8ab4f8" fontSize="7">Network</text>
    <rect x="0" y="14" width="56" height="111" fill="#1b1b1d" />
    <rect x="4" y="26" width="48" height="10" fill="#5c2b29" /><text x="7" y="33.5" fill="#f28b82" fontSize="6.5">users</text>
    <text x="64" y="28" fill="#e8eaed" fontSize="7" fontWeight="700">▼ General</text>
    <text x="64" y="44" fill="#9aa0a6" fontSize="6.5">Request URL:</text>
    <text x="64" y="54" fill="#e8eaed" fontSize="6.4">localhost:3000/<tspan fill="#ffb27a" fontWeight="700">undefined</tspan>/api/users</text>
    <rect x="61" y="36" width="134" height="22" rx="3" fill="none" stroke="#ff6b22" strokeWidth="2" />
    <text x="64" y="72" fill="#9aa0a6" fontSize="6.5">Request Method: <tspan fill="#e8eaed">GET</tspan></text>
    <text x="64" y="84" fill="#9aa0a6" fontSize="6.5">Status Code: <tspan fill="#f28b82">404 Not Found</tspan></text>
  </svg>;
}

export function CorsExample({ t }: { t: number }) {
  const app = cors.appAt(t);
  const pip = cors.pipAt(t);
  const card = cors.cardAt(t);
  const input = cors.chatInputAt(t);
  const keys = cors.keysAt(t);
  const messages: ChatItem[] = cors.chatAt(t).map((message) => message.role === "user"
    ? { ...message, images: [] }
    : { ...message, evidence: message.evidence ? <><HeadersThumb /><small>03:47:21 · Network › Headers</small></> : undefined });
  return <>
    <section className={styles.work} style={box(cors.WORK)} aria-label={app === "editor" ? "코드 에디터" : "브라우저"}>
      {app === "editor" ? <Editor state={cors.editorAt(t)} /> : <Browser state={cors.browserAt(t)} />}
    </section>

    <ClaudyChat project="acme-dashboard" messages={messages} input={{ ...input, attachments: [] }} />

    {card && <StickCard kind={card} x={600} y={card === "smart" ? 372 : 330}>
      {card === "dumb" && <span className={styles.cardNote}>CORS…? 헤더…?</span>}
    </StickCard>}
    {pip.visible && <LinkPip pip={pip} />}

    {keys && <Keycaps>{keys.keys.map((key, index) => <span key={key} className={styles.keyGroup}>{index > 0 && "+"}<kbd>{key}</kbd></span>)}{keys.note && <span>{keys.note}</span>}</Keycaps>}
    <Pointer {...cors.cursorAt(t)} />
    <Caption caption={cors.captionAt(t)} />
  </>;
}

function Editor({ state }: { state: cors.EditorState }) {
  const lines = state.active === "users.tsx"
    ? cors.CODE["users.tsx"].map((line, index) => index === 3 ? state.typedLine : line)
    : cors.CODE[state.active] ?? [];
  return <div className={styles.editor}>
    <header className={styles.editorTitle}><span>acme-dashboard — Visual Studio Code</span><em><Minus size={13} /><Square size={11} /><X size={13} /></em></header>
    <aside className={styles.activity}><Files size={22} weight="fill" /><MagnifyingGlass size={22} /><GitBranch size={22} data-active={state.active === "변경 사항"} /></aside>
    <nav className={styles.editorTabs}>
      {state.tabs.map((tab) => <span key={tab} data-active={tab === state.active} data-ai={["cors.ts", "next.config.js"].includes(tab)}>
        {tab}{tab === state.active && !state.saved ? <i className={styles.dirty} /> : <X size={10} />}
      </span>)}
    </nav>
    {state.active === "변경 사항"
      ? <div className={styles.diff} aria-label="변경 사항">
        <b>소스 제어 · 변경 사항 {state.diffRows}</b>
        {cors.DIFF_ROWS.slice(0, state.diffRows).map((row, index) => <p key={index} data-kind={row.kind}>
          <small>{row.file}</small><code>{row.kind === "add" ? "+" : "−"} {row.text}</code>
        </p>)}
      </div>
      : <pre className={styles.code}>{lines.map((line, index) => <p key={index}><span>{index + 1}</span>{colorize(line)}</p>)}</pre>}
    <div className={styles.terminal}>
      <header><TerminalWindow size={13} />터미널<small>npm run dev</small></header>
      {state.terminal.map((line, index) => <p key={`${index}-${line}`} data-tone={line.startsWith("✓") ? "ok" : line.startsWith("^C") ? "warn" : undefined}>{line}</p>)}
    </div>
  </div>;
}

// Just enough highlighting to read as code.
function colorize(line: string) {
  const comment = line.indexOf("//");
  const body = comment >= 0 ? line.slice(0, comment) : line;
  const parts = body.split(/(".*?"|`.*?`|\b(?:export|default|function|const|return|import|from|async|module)\b)/g);
  return <>
    {parts.map((part, index) => /^["`]/.test(part) ? <em key={index} className={styles.string}>{part}</em>
      : /^(export|default|function|const|return|import|from|async|module)$/.test(part) ? <em key={index} className={styles.keyword}>{part}</em>
        : part)}
    {comment >= 0 && <em className={styles.aiComment}>{line.slice(comment)}</em>}
  </>;
}

function Browser({ state }: { state: cors.BrowserState }) {
  return <div className={styles.browser}>
    <header className={styles.browserTabs}><span>Users · Acme Dashboard<X size={11} /></span><em><Minus size={13} /><Square size={11} /><X size={13} /></em></header>
    <div className={styles.addressBar}>
      <ArrowLeft size={15} /><ArrowRight size={15} /><ArrowClockwise size={15} data-spinning={state.page === "loading"} />
      <span>localhost:3000/users</span>
    </div>
    <div className={styles.page}>
      <h3>Users</h3>
      {state.page === "loading" && <p className={styles.loading}><CircleNotch size={16} />불러오는 중…</p>}
      {state.page === "error" && <p className={styles.pageError}>사용자를 불러오지 못했습니다.</p>}
      {state.page === "loaded" && <table className={styles.users}><tbody>{USERS.map(([name, mail, role]) => <tr key={mail}><td>{name}</td><td>{mail}</td><td><i>{role}</i></td></tr>)}</tbody></table>}
      {state.page === "idle" && <div className={styles.skeleton}><i /><i /><i /></div>}
    </div>
    <div className={styles.devtools} style={{ top: cors.DEVTOOLS_TOP - cors.WORK.y }}>
      <nav className={styles.devtoolsTabs}>
        <span>Elements</span>
        <span data-active={state.devtoolsTab === "console"}>Console{state.consoleError && <b>1</b>}</span>
        <span data-active={state.devtoolsTab === "network"}>Network</span>
        <span>Sources</span>
      </nav>
      {state.devtoolsTab === "console"
        ? <div className={styles.console}>
          {state.consoleError
            ? <p className={styles.consoleError} data-selected={state.errorSelected}><X size={11} weight="bold" /><span>Uncaught (in promise) {cors.ERROR_TEXT}</span><small>users.tsx:5</small></p>
            : <p className={styles.consoleEmpty}>{state.page === "loaded" ? "콘솔 메시지 없음" : ""}</p>}
        </div>
        : <div className={styles.network}>
          <p className={styles.networkHead}><span>Name</span><span>Status</span><span>Type</span><span>Time</span></p>
          <p><span>users</span><span>200</span><span>document</span><span>41 ms</span></p>
          <p data-failed={state.requestStatus === 404} data-selected={state.headersOpen}><span>users</span><span>{state.requestStatus ?? "-"}</span><span>fetch</span><span>12 ms</span></p>
          <p><span>main.js</span><span>200</span><span>script</span><span>8 ms</span></p>
          {state.headersOpen && <div className={styles.headers} style={{ left: cors.HEADERS_PANEL.x - cors.WORK.x, top: cors.HEADERS_PANEL.y - cors.DEVTOOLS_TOP }}>
            <nav><X size={12} /><b>Headers</b><span>Preview</span><span>Response</span></nav>
            <strong>▼ General</strong>
            <p><span>Request URL</span><code>{cors.REQUEST_URL}</code></p>
            <p><span>Request Method</span><code>GET</code></p>
            <p><span>Status Code</span><code data-failed="true">404 Not Found</code></p>
          </div>}
        </div>}
    </div>
  </div>;
}

function LinkPip({ pip }: { pip: cors.PipState }) {
  const origin = { x: cors.PIP.x, y: cors.PIP.y };
  return <PipFrame rect={cors.PIP} mode={pip.link ? "Agent Link" : null} minimized={pip.minimized} pressedQuick={pip.quickPressed ? 1 : null}>
    <p className={styles.pipRow} style={{ top: 104 }}><span>전송 구간 <b>최근 30초</b></span><span>링크 20분 유효</span></p>
    <span className={styles.exportButton} data-busy={pip.exporting} style={{ left: 16, right: 16, top: cors.EXPORT_BUTTON.y - origin.y - 18 }}>
      {pip.exporting ? <CircleNotch className={styles.spin} size={15} /> : <LinkSimple size={15} />}AI Context 생성
    </span>
    {pip.exported && <>
      <p className={styles.pipSuccess} style={{ top: 184 }}><Check size={13} weight="bold" />링크 준비됨 · 오전 04:07 만료</p>
      <p className={styles.pipSteps} style={{ top: 206 }}>이 프롬프트만 AI에 붙여넣으세요.</p>
      <p className={styles.pipPrompt} style={{ top: 228 }}>{cors.LINK_PROMPT}</p>
      <span className={styles.copyButton} data-copied={pip.copied} style={{ left: 16, right: 16, top: cors.COPY_BUTTON.y - origin.y - 18 }}>
        {pip.copied ? <Check size={14} /> : <Copy size={14} />}{pip.copied ? "복사되었습니다" : "프롬프트 복사"}
      </span>
    </>}
  </PipFrame>;
}
