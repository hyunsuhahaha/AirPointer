import { ChalkboardTeacher, Check, CheckCircle, CircleNotch, Copy, Eye, LinkSimple, PaperPlaneRight, PushPin, Question, TerminalWindow, Users } from "@phosphor-icons/react";
import { CHAT, CHAT_INPUT, SEND_BUTTON } from "@/lib/usage-example-timeline";
import * as lesson from "@/lib/usage-example-class";
import { Caption, Keycaps, PipFrame, Pointer, box } from "./shared";
import styles from "./class-example.module.css";

// Example: the coding instructor. Commands vanish on `clear`, the class chat
// floods with questions, and one pinned link lets every student replay it.

export function ClassExample({ t }: { t: number }) {
  const chat = lesson.chatAt(t);
  const pip = lesson.pipAt(t);
  const keys = lesson.keysAt(t);
  return <>
    <header className={styles.hud}>
      <b><i />LIVE · 3강 Todo 앱 만들기</b>
      <span><Users size={14} weight="bold" />수강생 <em>{lesson.STUDENTS_TOTAL}명</em></span>
      <span data-alert={chat.unanswered > 0}><Question size={14} weight="bold" />미답변 질문 <em>{chat.unanswered}</em></span>
    </header>
    <section className={styles.work} style={box(lesson.WORK)} aria-label="강사 화면">
      <header className={styles.title}><ChalkboardTeacher size={16} weight="fill" />화면 공유 중 · 강사</header>
      <div className={styles.terminal}>
        <p className={styles.terminalBar}><TerminalWindow size={14} />zsh — ~/class/todo</p>
        {lesson.terminalAt(t).map((line, index) => <p key={index} data-kind={line.kind}>
          {line.text}{line.typing && <i className={styles.caret} />}
        </p>)}
      </div>
    </section>
    <ClassChat t={t} chat={chat} />
    {lesson.sharedAt(t) && <SharedReplay t={t} />}
    {pip.visible && <LinkPip pip={pip} />}
    {t >= lesson.BEATS.board && <Board rows={lesson.boardRowsAt(t)} />}

    {keys && <Keycaps>{keys.keys.map((key, index) => <span key={key} className={styles.keyGroup}>{index > 0 && "+"}<kbd>{key}</kbd></span>)}{keys.note && <span>{keys.note}</span>}</Keycaps>}
    {t < lesson.BEATS.board && <Pointer {...lesson.cursorAt(t)} />}
    <Caption caption={lesson.captionAt(t)} />
  </>;
}

function ClassChat({ t, chat }: { t: number; chat: ReturnType<typeof lesson.chatAt> }) {
  const input = lesson.chatInputAt(t);
  return <section className={styles.chat} style={box(CHAT)} aria-label="수업 채팅">
    <header><b># 3강-실습</b><small><Users size={13} />{lesson.STUDENTS_TOTAL}명</small></header>
    {chat.pinned && <p className={styles.pinned}><PushPin size={14} weight="fill" /><span>공지 · 최근 3분 화면 기록</span><em><Eye size={13} weight="bold" />{lesson.viewersAt(t)}/{lesson.STUDENTS_TOTAL}</em></p>}
    <div className={styles.messages} style={{ top: chat.pinned ? 96 : 56, height: CHAT_INPUT.y - CHAT.y - (chat.pinned ? 104 : 64) }}>
      {chat.entries.map((entry) => entry.kind === "student"
        ? <div key={entry.id} className={styles.message}>
          <i style={{ background: entry.color }}>{entry.name.slice(0, 1)}</i>
          <div><b>{entry.name}</b><p>{entry.text}</p>{entry.resolved && <small className={styles.resolved}><CheckCircle size={12} weight="fill" />해결됨</small>}</div>
        </div>
        : entry.kind === "teacher"
          ? <div key={entry.id} className={styles.message} data-teacher="true">
            <i><ChalkboardTeacher size={15} weight="fill" /></i>
            <div><b>강사</b><p><code>{entry.text}</code></p></div>
          </div>
          : <div key={entry.id} className={styles.notice}>
            <b><PushPin size={13} weight="fill" />강사 공지</b>
            <p>{entry.text}</p>
            <span className={styles.linkCard}><LinkSimple size={16} weight="bold" /><span><b>whatwas · 최근 3분 화면 기록</b><small>명령어 6개 · 화면 36장</small></span></span>
          </div>)}
    </div>
    <div className={styles.input} style={box(CHAT_INPUT, CHAT)}>
      <span data-empty={!input.text}>{input.text || "메시지 보내기"}{input.typing && <i className={styles.caret} />}</span>
      <b style={{ left: SEND_BUTTON.x - CHAT_INPUT.x - 16, top: SEND_BUTTON.y - CHAT_INPUT.y - 16 }}><PaperPlaneRight size={15} weight="fill" /></b>
    </div>
  </section>;
}

// What students see when they open the link: the terminal, command by command.
function SharedReplay({ t }: { t: number }) {
  const index = lesson.replayIndexAt(t);
  const viewers = lesson.viewersAt(t);
  const shown = lesson.COMMANDS.slice(0, index + 1);
  return <section className={styles.shared} aria-label="공유된 화면">
    <header><LinkSimple size={15} weight="bold" />whatwas · 공유된 화면<small>최근 3분 · 수강생 화면</small></header>
    <div className={styles.replay}>
      {shown.map((command, commandIndex) => <div key={command.cmd} data-current={commandIndex === index}>
        <p>$ {command.cmd}</p>
        {command.output.map((line) => <small key={line}>{line}</small>)}
      </div>)}
    </div>
    <div className={styles.timeline}>
      {lesson.COMMANDS.map((command, commandIndex) => <span key={command.cmd} data-current={commandIndex === index} data-seen={commandIndex < index}>{command.label}</span>)}
      <b>clear</b>
    </div>
    <footer>
      <b><Eye size={16} weight="bold" />지금 {viewers}명이 보는 중</b>
      <span className={styles.viewerBar}><i style={{ width: `${(viewers / lesson.STUDENTS_TOTAL) * 100}%` }} /></span>
      <small>{viewers} / {lesson.STUDENTS_TOTAL}</small>
    </footer>
  </section>;
}

function Board({ rows }: { rows: number }) {
  return <section className={styles.board} aria-label="수업 비교">
    <header><small>같은 수업 · 같은 명령어</small><b>“아까 그거” 질문을 처리하는 비용</b></header>
    <div className={styles.boardGrid}>
      <span /><em>기존</em><em data-after="true">방금그거뭐였지</em>
      {lesson.COMPARISON.slice(0, rows).map((row) => <p key={row.label} className={styles.boardRow}>
        <span>{row.label}</span><s>{row.before}</s><b>{row.after}</b>
      </p>)}
    </div>
  </section>;
}

function LinkPip({ pip }: { pip: lesson.PipState }) {
  const origin = { x: lesson.PIP.x, y: lesson.PIP.y };
  return <PipFrame rect={lesson.PIP} mode={pip.link ? "Agent Link" : null} minimized={pip.minimized} pressedQuick={pip.quickPressed ? 1 : null}>
    <p className={styles.pipRow} style={{ top: 104 }}><span>전송 구간 <b>최근 3분</b></span><span>링크를 가진 사람 누구나 · 20분</span></p>
    <span className={styles.exportButton} data-busy={pip.exporting} style={{ left: 16, right: 16, top: lesson.PIP_EXPORT.y - origin.y - 18 }}>
      {pip.exporting ? <CircleNotch className={styles.spin} size={15} /> : <LinkSimple size={15} />}AI Context 생성
    </span>
    {pip.exported && <>
      <p className={styles.pipSuccess} style={{ top: 184 }}><Check size={13} weight="bold" />링크 준비됨 · 오후 09:40 만료</p>
      <p className={styles.pipSteps} style={{ top: 206 }}>채팅방이나 AI에 이 링크를 붙여넣으세요.</p>
      <p className={styles.pipPrompt} style={{ top: 228 }}>{lesson.LINK_URL}</p>
      <span className={styles.copyButton} data-copied={pip.copied} style={{ left: 16, right: 16, top: lesson.COPY_BUTTON.y - origin.y - 18 }}>
        {pip.copied ? <Check size={14} /> : <Copy size={14} />}{pip.copied ? "복사되었습니다" : "링크 복사"}
      </span>
    </>}
  </PipFrame>;
}
