import { ArrowUp, Check, CircleNotch, Copy, FolderOpen, Globe, HardDrives, Paperclip, ShieldCheck, TerminalWindow } from "@phosphor-icons/react";
import { CHAT, CHAT_INPUT, SEND_BUTTON } from "@/lib/usage-example-timeline";
import * as install from "@/lib/usage-example-install";
import { Caption, ClaudyLogo, Keycaps, PipFrame, Pointer, ShutterFlash, box } from "./shared";
import styles from "./install-example.module.css";

// Example: the infra engineer (Local Folder). A three-minute install fails;
// the warning that explains it scrolled past long ago. A local agent reads
// the saved minutes and the files on this PC and fixes it.

// The failing terminal as a small screenshot: only the last lines.
function ErrorShot() {
  return <svg viewBox="0 0 200 120" aria-hidden="true">
    <rect width="200" height="120" fill="#0d1117" />
    {[14, 28, 42, 56, 70].map((y) => <rect key={y} x="10" y={y} width={y === 70 ? 120 : 160 - y} height="6" rx="1" fill="#30363d" />)}
    <rect x="10" y="88" width="180" height="8" rx="1" fill="#f85149" />
  </svg>;
}

export function InstallExample({ t }: { t: number }) {
  const terminal = install.terminalAt(t);
  const agent = install.agentAt(t);
  const pip = install.pipAt(t);
  const snip = install.snipAt(t);
  const keys = install.keysAt(t);
  return <>
    <header className={styles.hud}>
      <b><TerminalWindow size={14} weight="bold" />설치 가이드 · kind + ingress</b>
      <span>진행 시간 <em>{terminal.clock}</em></span>
      {agent.sentNothing && <span data-safe="true"><ShieldCheck size={14} weight="fill" />외부 전송 0건</span>}
    </header>
    <section className={styles.work} style={box(install.WORK)} aria-label="터미널">
      <header className={styles.termBar}><i /><i /><i /><span>zsh — ~/infra</span></header>
      <div className={styles.lines}>
        {terminal.lines.map((line, index) => <p key={`${index}-${line.text}`} data-kind={line.kind}>{line.text || " "}</p>)}
      </div>
      {terminal.scrolledHint && <p className={styles.scrollHint}>↑ 위로 1,284줄… 어디쯤이었는지 모르겠다</p>}
      {snip.toast && <div className={styles.snipToast}><span><ErrorShot /></span><p><b>캡처됨</b><small>지금 화면 한 장 · 01:12 경고는 없음</small></p></div>}
    </section>

    {agent.visible ? <AgentPanel agent={agent} t={t} /> : <WebAi t={t} />}
    {pip.visible && <FolderPip pip={pip} />}
    {t >= install.BEATS.board && <Board rows={install.boardRowsAt(t)} />}

    <ShutterFlash opacity={snip.flash} />
    {keys && <Keycaps>{keys.keys.map((key, index) => <span key={key} className={styles.keyGroup}>{index > 0 && "+"}<kbd>{key}</kbd></span>)}{keys.note && <span>{keys.note}</span>}</Keycaps>}
    {t < install.BEATS.board && <Pointer {...install.cursorAt(t)} />}
    <Caption caption={install.captionAt(t)} />
  </>;
}

function WebAi({ t }: { t: number }) {
  const chat = install.webChatAt(t);
  return <section className={styles.web} style={box(CHAT)} aria-label="웹 AI 채팅">
    <header><Globe size={18} weight="bold" /><b>웹 AI 채팅</b><small>브라우저</small></header>
    <div className={styles.webMessages} style={{ height: CHAT_INPUT.y - CHAT.y - 64 }}>
      {chat.messages.length === 0 && <p className={styles.webEmpty}>무엇이든 물어보세요</p>}
      {chat.messages.map((message) => message.role === "user"
        ? <div key={message.id} className={styles.webUser}>{message.images > 0 && <span className={styles.webShot}><ErrorShot /></span>}<p>{message.text}</p></div>
        : <div key={message.id} className={styles.webAi}>
          <i>AI</i>
          <div>{message.thinking ? <p className={styles.thinking}>생각하는 중…</p> : <p>{message.text}</p>}{message.done && <small>{message.done}</small>}</div>
        </div>)}
    </div>
    <div className={styles.webInput} style={box(CHAT_INPUT, CHAT)}>
      {chat.attached > 0 && <span className={styles.webAttachment}><ErrorShot /></span>}
      <span data-empty={!chat.input}>{chat.input || "메시지 보내기"}{chat.typing && <i className={styles.caret} />}</span>
      <Paperclip size={16} className={styles.clip} />
      <b style={{ left: SEND_BUTTON.x - CHAT_INPUT.x - 16, top: SEND_BUTTON.y - CHAT_INPUT.y - 16 }}><ArrowUp size={16} weight="bold" /></b>
    </div>
  </section>;
}

function AgentPanel({ agent, t }: { agent: ReturnType<typeof install.agentAt>; t: number }) {
  return <section className={styles.agent} style={box(CHAT)} aria-label="로컬 에이전트">
    <header><ClaudyLogo size={18} /><b>Claude Code</b><small><HardDrives size={13} weight="fill" />이 PC · ~/infra</small></header>
    <div className={styles.agentLog} style={{ height: CHAT_INPUT.y - CHAT.y - 64 }}>
      {agent.prompt && <p className={styles.agentPrompt}>&gt; {agent.prompt}</p>}
      {agent.steps.map((step) => <p key={step.detail} className={styles.agentStep} data-kind={step.kind}>
        <b>● {step.tool}</b><span>{step.detail}</span>
        {step.kind === "find" && <span className={styles.warnFrame}>WARNING: host port 80 is already in use (nginx)</span>}
        {step.kind === "edit" && <span className={styles.diff}><s>- hostPort: 80</s><ins>+ hostPort: 8081</ins></span>}
      </p>)}
      {agent.running && <p className={styles.agentRunning}><CircleNotch size={13} className={styles.spin} />작업 중 · {Math.max(1, Math.round((t - install.BEATS.enter) * 7))}초</p>}
      {agent.summary && <p className={styles.agentSummary}>{agent.summary}</p>}
    </div>
    <div className={styles.agentInput} style={box(CHAT_INPUT, CHAT)}>
      <span>&gt;</span><span data-empty={!agent.input}>{agent.input || "무엇을 도와드릴까요?"}</span>
    </div>
  </section>;
}

function FolderPip({ pip }: { pip: install.PipState }) {
  const origin = { x: install.PIP.x, y: install.PIP.y };
  return <PipFrame rect={install.PIP} mode={pip.folder ? "Local Folder" : null} minimized={pip.minimized} pressedQuick={pip.quickPressed ? 2 : null}>
    {pip.folder && <>
      <p className={styles.rangeLabel} style={{ top: 95 }}>전송 구간</p>
      {install.RANGE_CHIPS.map((label, index) => {
        const center = install.rangeChip(index);
        return <span key={label} className={styles.rangeChip} data-active={index === pip.range} style={{ left: center.x - origin.x - 50, top: center.y - origin.y - 15 }}>{label}</span>;
      })}
      <span className={styles.exportButton} data-busy={pip.exporting !== null} style={{ left: 16, right: 16, top: install.EXPORT_BUTTON.y - origin.y - 18 }}>
        {pip.exporting !== null ? <><CircleNotch className={styles.spin} size={15} />저장 중 · 화면 {Math.round(install.FRAMES_SAVED * pip.exporting)}장 · 녹화 조각</> : <><FolderOpen size={15} />AI Context 생성</>}
      </span>
    </>}
    {pip.exported && <>
      <p className={styles.pipSuccess} style={{ top: 214 }}><Check size={13} weight="bold" />{install.FOLDER} · 화면 {install.FRAMES_SAVED}장 · 녹화 6조각</p>
      <p className={styles.pipSteps} style={{ top: 236 }}>내 PC에만 저장됨 · 로컬 에이전트에 프롬프트를 붙여넣으세요.</p>
      <p className={styles.pipPrompt} style={{ top: 258 }}>{install.FOLDER_PROMPT}</p>
      <span className={styles.copyButton} data-copied={pip.copied} style={{ left: 16, right: 16, top: install.COPY_BUTTON.y - origin.y - 18 }}>
        {pip.copied ? <Check size={14} /> : <Copy size={14} />}{pip.copied ? "복사되었습니다" : "프롬프트 복사"}
      </span>
    </>}
  </PipFrame>;
}

function Board({ rows }: { rows: number }) {
  return <section className={styles.board} aria-label="캡처와 Local Folder 비교">
    <header><small>같은 3분짜리 설치</small><b>긴 과정을 AI에게 넘기려면</b></header>
    <div className={styles.boardGrid}>
      <span /><em>캡처 + 웹 AI</em><em data-after="true">Local Folder + 로컬 에이전트</em>
      {install.COMPARISON.slice(0, rows).map((row) => <p key={row.label} className={styles.boardRow}>
        <span>{row.label}</span><s>{row.before}</s><b>{row.after}</b>
      </p>)}
    </div>
  </section>;
}
