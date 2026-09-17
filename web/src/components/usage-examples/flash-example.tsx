import { ArrowClockwise, ArrowLeft, ArrowRight, ChartBar, Check, CircleNotch, Copy, Eye, GearSix, Hash, House, LinkSimple, Minus, PaperPlaneRight, Square, X } from "@phosphor-icons/react";
import { CHAT, CHAT_INPUT, SEND_BUTTON } from "@/lib/usage-example-timeline";
import * as flash from "@/lib/usage-example-flash";
import { Caption, ClaudyLogo, Keycaps, PipFrame, Pointer, ShutterFlash, StickCard, box } from "./shared";
import styles from "./flash-example.module.css";

// Example: "팀원은 못 보는 번쩍임". The designer's staging app on the left, the
// team channel on the right, and one shared link the whole team opens.

const NAV_ICONS = { 대시보드: House, 리포트: ChartBar, 설정: GearSix } as const;

// The dark staging page as a thumbnail; `flashed` is the white first paint.
function PageThumb({ flashed = false, highlight = false }: { flashed?: boolean; highlight?: boolean }) {
  return <svg viewBox="0 0 200 125" aria-hidden="true">
    <rect width="200" height="125" fill={flashed ? "#fafafa" : "#0f1117"} />
    <rect width="44" height="125" fill={flashed ? "#eceef2" : "#161a23"} />
    {[18, 30, 42].map((y) => <rect key={y} x="8" y={y} width="28" height="5" rx="1" fill={flashed ? "#c9ced8" : "#2c3345"} />)}
    <rect x="54" y="14" width="60" height="7" rx="1" fill={flashed ? "#1f2328" : "#e6e8ee"} />
    {[0, 1, 2].map((index) => <rect key={index} x={54 + index * 48} y="30" width="42" height="30" rx="3" fill={flashed ? "#ffffff" : "#1b2130"} stroke={flashed ? "#dfe3ea" : "none"} />)}
    <rect x="54" y="68" width="138" height="48" rx="3" fill={flashed ? "#ffffff" : "#1b2130"} stroke={flashed ? "#dfe3ea" : "none"} />
    {highlight && <rect x="3" y="3" width="194" height="119" rx="4" fill="none" stroke="#ff6b22" strokeWidth="4" />}
  </svg>;
}

function Avatar({ author, size = 30 }: { author: flash.Author; size?: number }) {
  const member = flash.TEAM[author];
  return <i className={styles.avatar} style={{ width: size, height: size, background: member.color, fontSize: size * 0.42 }}>{member.name.slice(0, 1)}</i>;
}

export function FlashExample({ t }: { t: number }) {
  const pip = flash.pipAt(t);
  const card = flash.cardAt(t);
  const keys = flash.keysAt(t);
  const capture = flash.captureAt(t);
  return <>
    <section className={styles.work} style={box(flash.WORK)} aria-label="스테이징 사이트">
      <Staging state={flash.browserAt(t)} />
      {capture.missed && <div className={styles.snipResult}><PageThumb /><p><b>캡처됨</b><small>…번쩍임은 안 찍힘</small></p></div>}
    </section>
    <TeamChat t={t} />
    {flash.sharedCardAt(t) && <SharedScreen t={t} />}

    {card && <StickCard kind={card} x={600} y={card === "smart" ? 372 : 330}>
      {card === "dumb" && <span className={styles.cardNote}>다크모드 코드는 정상인데요?</span>}
    </StickCard>}
    {pip.visible && <LinkPip pip={pip} />}

    <ShutterFlash opacity={capture.flash} />
    {keys && <Keycaps>{keys.keys.map((key, index) => <span key={key} className={styles.keyGroup}>{index > 0 && "+"}<kbd>{key}</kbd></span>)}{keys.note && <span>{keys.note}</span>}</Keycaps>}
    <Pointer {...flash.cursorAt(t)} />
    <Caption caption={flash.captionAt(t)} />
  </>;
}

function Staging({ state }: { state: flash.BrowserState }) {
  return <div className={styles.browser}>
    <header className={styles.browserTabs}><span>{state.page} · Acme Studio (staging)<X size={11} /></span><em><Minus size={13} /><Square size={11} /><X size={13} /></em></header>
    <div className={styles.addressBar}>
      <ArrowLeft size={15} /><ArrowRight size={15} /><ArrowClockwise size={15} data-spinning={state.reloading} />
      <span>staging.acme.studio/{state.page === "대시보드" ? "" : state.page === "리포트" ? "reports" : "settings"}</span>
      {state.fixed && <b className={styles.deployed}><Check size={12} weight="bold" />새 배포</b>}
    </div>
    <div className={styles.app}>
      <nav className={styles.sidebar}>
        <b>Acme Studio</b>
        {flash.NAV.map((page) => {
          const Icon = NAV_ICONS[page];
          const center = flash.navCenter(page);
          return <span key={page} data-active={page === state.page} style={{ top: center.y - flash.WORK.y - 69 - 17 }}><Icon size={16} />{page}</span>;
        })}
      </nav>
      <main className={styles.content} key={state.page}>
        <h3>{state.page}</h3>
        <div className={styles.cards}>{[["방문자", "12,408"], ["전환율", "3.8%"], ["매출", "₩4.2M"]].map(([label, value]) => <p key={label}><small>{label}</small><b>{value}</b></p>)}</div>
        <div className={styles.chart}>{[38, 62, 45, 80, 56, 90, 70, 64, 84, 52].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
      </main>
      {state.flash > 0 && <div className={styles.whiteFlash} style={{ opacity: state.flash }} aria-hidden="true">
        <i /><i /><i />
      </div>}
    </div>
  </div>;
}

function TeamChat({ t }: { t: number }) {
  const chat = flash.chatAt(t);
  const input = flash.chatInputAt(t);
  return <section className={styles.chat} style={box(CHAT)} aria-label="팀 채팅">
    <header>
      <Hash size={18} weight="bold" /><b>디자인-qa</b>
      <span className={styles.members}>{(["minjun", "seoyeon", "jiho", "me"] as const).map((author) => <Avatar key={author} author={author} size={22} />)}<small>4명</small></span>
    </header>
    <div className={styles.messages} style={{ height: CHAT_INPUT.y - CHAT.y - 80 }}>
      {chat.messages.map((message) => message.kind === "text"
        ? <div key={message.id} className={styles.message} data-me={message.author === "me"}>
          <Avatar author={message.author} />
          <div>
            <p className={styles.byline}><b>{flash.TEAM[message.author].name}</b><small>{flash.TEAM[message.author].role}</small></p>
            {message.image && <span className={styles.shot}><PageThumb /></span>}
            <p className={styles.text}>{message.text}</p>
            {message.views !== undefined && <p className={styles.views} data-active={message.views > 0}>
              <Eye size={14} weight="bold" />{message.views > 0 ? `${message.views}명이 이 화면을 봤어요` : "아직 아무도 안 봤어요"}
              <span>{flash.viewersAt(t).map((viewer) => <Avatar key={viewer.author} author={viewer.author} size={18} />)}</span>
            </p>}
          </div>
        </div>
        : <div key={message.id} className={styles.analysis}>
          <header><ClaudyLogo size={18} /><b>민준의 AI</b><small>공유 링크 분석</small></header>
          {message.thinking ? <p className={styles.thinking}>화면 기록 확인 중…</p> : <p>{message.text}</p>}
          {message.tools.map((tool) => <code key={tool}>{tool}</code>)}
          {message.evidence && <span className={styles.evidence}><PageThumb flashed highlight /><small>01:24:07 · 라이트로 그려진 첫 화면</small></span>}
          {message.done && <p>{message.done}</p>}
        </div>)}
      {chat.typing && <p className={styles.typing}>{chat.typing} 님이 입력 중<i /><i /><i /></p>}
    </div>
    <div className={styles.input} style={box(CHAT_INPUT, CHAT)}>
      {input.image && <span className={styles.attachment}><PageThumb /></span>}
      <span className={styles.inputText} data-empty={!input.text}>{input.text || "#디자인-qa에 메시지 보내기"}{input.typing && <i className={styles.caret} />}</span>
      <span className={styles.send} style={{ left: SEND_BUTTON.x - CHAT_INPUT.x - 16, top: SEND_BUTTON.y - CHAT_INPUT.y - 16 }}><PaperPlaneRight size={15} weight="fill" /></span>
    </div>
  </section>;
}

// What every teammate sees when they open the link: the same recording.
function SharedScreen({ t }: { t: number }) {
  const viewers = flash.viewersAt(t);
  return <section className={styles.shared} aria-label="공유된 화면">
    <header><LinkSimple size={15} weight="bold" />whatwas · 공유된 화면<small>최근 30초 · 01:23:48 – 01:24:18</small></header>
    <div className={styles.sharedFrame}><PageThumb flashed /><em>01:24:07</em></div>
    <div className={styles.strip}>{[false, false, true, false, false, true, false].map((flashed, index) => <span key={index} data-flashed={flashed}><PageThumb flashed={flashed} /></span>)}</div>
    <footer>
      <b><Eye size={16} weight="bold" />지금 보는 중 {viewers.length}명</b>
      <span>{viewers.map((viewer) => <em key={viewer.author}><Avatar author={viewer.author} size={26} />{flash.TEAM[viewer.author].name}<small>{flash.TEAM[viewer.author].role}</small></em>)}</span>
    </footer>
  </section>;
}

function LinkPip({ pip }: { pip: flash.PipState }) {
  const origin = { x: flash.PIP.x, y: flash.PIP.y };
  return <PipFrame rect={flash.PIP} mode={pip.link ? "Agent Link" : null} minimized={pip.minimized} pressedQuick={pip.quickPressed ? 1 : null}>
    <p className={styles.pipRow} style={{ top: 104 }}><span>전송 구간 <b>최근 30초</b></span><span>링크를 가진 사람 누구나 · 20분</span></p>
    <span className={styles.exportButton} data-busy={pip.exporting} style={{ left: 16, right: 16, top: flash.PIP_EXPORT.y - origin.y - 18 }}>
      {pip.exporting ? <CircleNotch className={styles.spin} size={15} /> : <LinkSimple size={15} />}AI Context 생성
    </span>
    {pip.exported && <>
      <p className={styles.pipSuccess} style={{ top: 184 }}><Check size={13} weight="bold" />링크 준비됨 · 오전 01:44 만료</p>
      <p className={styles.pipSteps} style={{ top: 206 }}>팀 채팅이나 AI에 이 링크를 그대로 붙여넣으세요.</p>
      <p className={styles.pipPrompt} style={{ top: 228 }}>{flash.LINK_PROMPT}</p>
      <span className={styles.copyButton} data-copied={pip.copied} style={{ left: 16, right: 16, top: flash.COPY_BUTTON.y - origin.y - 18 }}>
        {pip.copied ? <Check size={14} /> : <Copy size={14} />}{pip.copied ? "복사되었습니다" : "링크 복사"}
      </span>
    </>}
  </PipFrame>;
}
