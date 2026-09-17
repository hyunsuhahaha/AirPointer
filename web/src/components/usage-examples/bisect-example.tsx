import { ArrowCounterClockwise, Check, CircleNotch, Copy, FolderOpen, HardDrives, Lightning } from "@phosphor-icons/react";
import { CHAT, CHAT_INPUT } from "@/lib/usage-example-timeline";
import * as bisect from "@/lib/usage-example-bisect";
import { Caption, ClaudyLogo, Keycaps, PipFrame, Pointer, box } from "./shared";
import shared from "./install-example.module.css";
import styles from "./bisect-example.module.css";

// Example: the vibe coder (Local Folder). An AI agent edits the landing page
// twelve times; the sign-up button disappears somewhere. The saved minutes
// and this PC's file-save times line up on one clock and point at edit 7.

// A tiny landing page for timeline thumbnails and before/after frames.
function MiniPage({ cta, hue }: { cta: boolean; hue: number }) {
  return <svg viewBox="0 0 64 40" aria-hidden="true">
    <rect width="64" height="40" fill={`hsl(${hue} 60% 14%)`} />
    <rect x="4" y="4" width="14" height="3" rx="1" fill="#cbd5e1" />
    <rect x="12" y="11" width="40" height="5" rx="1" fill="#f8fafc" />
    <rect x="16" y="19" width="32" height="2" rx="1" fill="#94a3b8" />
    {cta ? <rect x="22" y="25" width="20" height="6" rx="3" fill="#f97316" /> : <rect x="22" y="25" width="20" height="6" rx="3" fill="none" stroke="#ef4444" strokeWidth=".8" strokeDasharray="1.5 1" />}
  </svg>;
}

export function BisectExample({ t }: { t: number }) {
  const preview = bisect.previewAt(t);
  const agent = bisect.agentAt(t);
  const pip = bisect.pipAt(t);
  const keys = bisect.keysAt(t);
  return <>
    <header className={shared.hud}>
      <b><Lightning size={14} weight="fill" />AI 자동 수정 · landing</b>
      {t >= bisect.BEATS.taskSend && <span className={styles.request}>내 요청 <em>“{bisect.TASK}”</em></span>}
      <span>수정 <em>{preview.edits}</em> / 12</span>
      {preview.fixed && <span data-safe="true"><Check size={14} weight="bold" />1줄만 되돌림 · 11개 유지</span>}
    </header>
    <section className={styles.work} style={box(bisect.WORK)} aria-label="작업 화면">
      <Preview preview={preview} />
      <Timeline t={t} />
      {bisect.timelineAt(t).clueless && <Clueless t={t} />}
    </section>

    <AgentPanel agent={agent} t={t} />
    {pip.visible && <FolderPip pip={pip} />}
    {t >= bisect.BEATS.board && <Board rows={bisect.boardRowsAt(t)} />}

    {keys && <Keycaps>{keys.keys.map((key, index) => <span key={key} className={shared.keyGroup}>{index > 0 && "+"}<kbd>{key}</kbd></span>)}{keys.note && <span>{keys.note}</span>}</Keycaps>}
    {t < bisect.BEATS.board && <Pointer {...bisect.cursorAt(t)} />}
    <Caption caption={bisect.captionAt(t)} />
  </>;
}

function Preview({ preview }: { preview: bisect.PreviewState }) {
  const { CTA } = bisect;
  return <div className={styles.preview} style={{ top: bisect.PREVIEW_TOP, height: bisect.PREVIEW_HEIGHT }}>
    <header className={styles.browserBar}><i /><i /><i /><span>localhost:3000</span>{preview.refreshing && <small><CircleNotch size={11} className={shared.spin} />새로고침</small>}</header>
    <div className={styles.page} data-refreshing={preview.refreshing} style={{ background: `radial-gradient(120% 90% at 50% 0%, hsl(${preview.hue} 70% 24%), hsl(${preview.hue} 50% 8%))` }}>
      <nav><b>Stacklet</b><span>기능</span><span>가격</span><span>블로그</span></nav>
      <h2 style={{ fontSize: preview.headline }}>팀의 배포를 한 화면에서</h2>
      <p>빌드부터 롤백까지, 클릭 한 번으로 끝내세요.{preview.edits >= 9 && " 14일 무료."}</p>
      {preview.ctaVisible
        ? <span className={styles.cta} data-back={preview.fixed} style={{ left: CTA.x, top: CTA.y - bisect.PREVIEW_TOP - 36, width: CTA.width, height: CTA.height }}>무료로 시작하기</span>
        : preview.notice && <span className={styles.ctaGone} style={{ left: CTA.x - 6, top: CTA.y - bisect.PREVIEW_TOP - 42, width: CTA.width + 12, height: CTA.height + 12 }}>가입 버튼 어디 갔지?</span>}
      <ul className={styles.features}>{["자동 배포", "원클릭 롤백", "팀 알림"].map((label) => <li key={label}>{label}</li>)}</ul>
    </div>
  </div>;
}

function Timeline({ t }: { t: number }) {
  const line = bisect.timelineAt(t);
  const { TIMELINE, EDITS, BREAKING_EDIT } = bisect;
  const breakX = bisect.timelineX(bisect.BREAK_SCREEN_SECONDS);
  return <div className={styles.timeline} style={{ top: TIMELINE.top, height: TIMELINE.height }}>
    <p className={styles.timelineHead}><b>최근 5분</b><span>14:00</span><span>14:05</span></p>
    <p className={styles.rowLabel} style={{ top: TIMELINE.screenRow - TIMELINE.top - 36 }}>화면 기록 · Local Folder</p>
    <p className={styles.rowLabel} style={{ top: TIMELINE.fileRow - TIMELINE.top - 32 }}>파일 저장 · 이 PC의 에디터 기록</p>
    <i className={styles.axis} style={{ left: TIMELINE.left, width: TIMELINE.width, top: TIMELINE.screenRow - TIMELINE.top }} />
    <i className={styles.axis} style={{ left: TIMELINE.left, width: TIMELINE.width, top: TIMELINE.fileRow - TIMELINE.top }} />
    {!line.screen && <span className={styles.rowPending} style={{ top: TIMELINE.screenRow - TIMELINE.top - 10 }}>● 백그라운드에서 기록 중</span>}
    {line.screen && bisect.SCREEN_MARKS.map((index) => {
      const broken = index >= BREAKING_EDIT && !line.reverted;
      return <span key={index} className={styles.thumb} data-break={index === BREAKING_EDIT && line.link} style={{ left: bisect.timelineX(EDITS[index].seconds + bisect.REFRESH_DELAY) - 24, top: TIMELINE.screenRow - TIMELINE.top - 16 }}>
        <MiniPage cta={!broken} hue={245 - Math.min(index + 1, 6) * 7} />
      </span>;
    })}
    {EDITS.slice(0, line.saves).map((edit, index) => <span key={index} className={styles.save} data-break={index === BREAKING_EDIT && line.link} data-reverted={index === BREAKING_EDIT && line.reverted} data-unknown={line.clueless} style={{ left: bisect.timelineX(edit.seconds) - 11, top: TIMELINE.fileRow - TIMELINE.top - 11 }}>
      {index === BREAKING_EDIT && line.reverted ? <ArrowCounterClockwise size={12} weight="bold" /> : index + 1}
    </span>)}
    {line.link && <>
      <i className={styles.link} style={{ left: breakX, top: TIMELINE.screenRow - TIMELINE.top - 22, height: TIMELINE.fileRow - TIMELINE.screenRow + 34 }} />
      <p className={styles.linkLabel} style={{ left: Math.min(breakX - 250, 700 - 500), top: TIMELINE.fileRow - TIMELINE.top + 16 }}>
        저장 <b>{bisect.clockLabel(EDITS[BREAKING_EDIT].seconds)}</b> Hero.module.css → 0.3초 뒤 화면 <b>{bisect.clockLabel(bisect.BREAK_SCREEN_SECONDS)}</b> 버튼 사라짐
      </p>
    </>}
  </div>;
}

// Nobody knows which of the twelve edits did it.
function Clueless({ t }: { t: number }) {
  const shown = Math.min(12, Math.floor((t - bisect.BEATS.clueless[0]) / 0.07) + 1);
  return <div className={styles.clueless} style={{ top: bisect.PREVIEW_TOP + 50 }}>
    <b>몇 번째 수정에서 사라진 거지?</b>
    <p>{bisect.EDITS.slice(0, shown).map((edit, index) => <span key={index}>{index + 1}번?<small>{edit.file}</small></span>)}</p>
    <em><span>나: 화면만 봤지 뭐가 바뀌었는지 모름</span><span>AI: 코드만 고쳤지 화면을 못 봄</span></em>
  </div>;
}

function AgentPanel({ agent, t }: { agent: ReturnType<typeof bisect.agentAt>; t: number }) {
  return <section className={shared.agent} style={box(CHAT)} aria-label="로컬 에이전트">
    <header><ClaudyLogo size={18} /><b>Claude Code</b><small><HardDrives size={13} weight="fill" />이 PC · ~/landing</small></header>
    <div className={shared.agentLog} style={{ height: CHAT_INPUT.y - CHAT.y - 64 }}>
      {agent.lines.map((line) => {
        if (line.kind === "user") return <p key={line.id} className={line.id === "task" ? `${shared.agentPrompt} ${styles.taskPrompt}` : shared.agentPrompt}>&gt; {line.text}</p>;
        if (line.kind === "edit") {
          const edit = bisect.EDITS[line.index];
          return <p key={line.id} className={styles.editLine}><b>● Edit {String(line.index + 1).padStart(2, "0")}</b><span>{edit.file} · {edit.summary}</span></p>;
        }
        if (line.kind === "reply") return <p key={line.id} className={styles.reply}>{line.thinking ? <em>생각하는 중…</em> : line.text}</p>;
        if (line.kind === "summary") return <p key={line.id} className={shared.agentSummary}>{line.text}</p>;
        const { step } = line;
        return <p key={line.id} className={shared.agentStep} data-kind={step.kind === "match" || step.kind === "edit" ? "find" : step.kind}>
          <b>● {step.tool}</b><span>{step.detail}</span>
          {step.kind === "find" && <span className={styles.beforeAfter}><i><MiniPage cta hue={210} /></i>→<i><MiniPage cta={false} hue={203} /></i></span>}
          {step.kind === "edit" && <span className={shared.diff}><s>- .cta {"{"} padding: 20px 32px {"}"}</s><ins>+ .cta {"{"} padding: 0; height: 0; overflow: hidden {"}"}</ins></span>}
        </p>;
      })}
      {agent.running && <p className={shared.agentRunning}><CircleNotch size={13} className={shared.spin} />{t < bisect.BEATS.ask ? "랜딩 페이지 수정 중" : "기록과 저장 시각 맞춰보는 중"}</p>}
    </div>
    <div className={shared.agentInput} style={box(CHAT_INPUT, CHAT)}>
      <span>&gt;</span><span data-empty={!agent.input}>{agent.input || "무엇을 도와드릴까요?"}{agent.typing && <i className={shared.caret} />}</span>
    </div>
  </section>;
}

function FolderPip({ pip }: { pip: bisect.PipState }) {
  const origin = { x: bisect.PIP.x, y: bisect.PIP.y };
  return <PipFrame rect={bisect.PIP} mode={pip.folder ? "Local Folder" : null} minimized={pip.minimized} pressedQuick={pip.quickPressed ? 2 : null}>
    {pip.folder && <>
      <p className={shared.rangeLabel} style={{ top: 95 }}>전송 구간</p>
      {bisect.RANGE_CHIPS.map((label, index) => {
        const center = bisect.rangeChip(index);
        return <span key={label} className={shared.rangeChip} data-active={index === pip.range} style={{ left: center.x - origin.x - 50, top: center.y - origin.y - 15 }}>{label}</span>;
      })}
      <span className={shared.exportButton} data-busy={pip.exporting !== null} style={{ left: 16, right: 16, top: bisect.EXPORT_BUTTON.y - origin.y - 18 }}>
        {pip.exporting !== null ? <><CircleNotch className={shared.spin} size={15} />저장 중 · 화면 {Math.round(bisect.FRAMES_SAVED * pip.exporting)}장 · 녹화 원본</> : <><FolderOpen size={15} />AI Context 생성</>}
      </span>
    </>}
    {pip.exported && <>
      <p className={shared.pipSuccess} style={{ top: 214 }}><Check size={13} weight="bold" />{bisect.FOLDER} · 화면 {bisect.FRAMES_SAVED}장 · 녹화 원본</p>
      <p className={shared.pipSteps} style={{ top: 236 }}>내 PC에만 저장됨 · 로컬 에이전트에 프롬프트를 붙여넣으세요.</p>
      <p className={shared.pipPrompt} style={{ top: 258 }}>{bisect.FOLDER_PROMPT}</p>
      <span className={shared.copyButton} data-copied={pip.copied} style={{ left: 16, right: 16, top: bisect.COPY_BUTTON.y - origin.y - 18 }}>
        {pip.copied ? <Check size={14} /> : <Copy size={14} />}{pip.copied ? "복사되었습니다" : "프롬프트 복사"}
      </span>
    </>}
  </PipFrame>;
}

function Board({ rows }: { rows: number }) {
  return <section className={shared.board} aria-label="화면 녹화와 Local Folder 비교">
    <header><small>같은 5분, 같은 12번의 수정</small><b>버튼을 없앤 수정을 찾으려면</b></header>
    <div className={shared.boardGrid}>
      <span /><em>화면 녹화 영상</em><em data-after="true">Local Folder + 로컬 에이전트</em>
      {bisect.COMPARISON.slice(0, rows).map((row) => <p key={row.label} className={shared.boardRow}>
        <span>{row.label}</span><s>{row.before}</s><b>{row.after}</b>
      </p>)}
    </div>
  </section>;
}
