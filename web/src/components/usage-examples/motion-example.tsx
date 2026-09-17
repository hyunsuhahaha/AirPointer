import type { CSSProperties, ReactNode } from "react";
import { ArrowLeft, Check, DeviceMobile, FileVideo, Play, SlackLogo, Warning } from "@phosphor-icons/react";
import { CHAT_INPUT } from "@/lib/usage-example-timeline";
import * as motion from "@/lib/usage-example-motion";
import { Caption, ClaudyChat, Keycaps, PipFrame, Pointer, box } from "./shared";
import type { ChatItem } from "./shared";
import styles from "./motion-example.module.css";

// Example: the publisher (Manual). A 0.4 s card-expand transition becomes
// three frames the AI can read, and the result matches the reference.

// The travel app. The reference opens the first card as a shared-element
// hero: the photo zooms, the list behind recedes, the title rises and the
// detail sheet slides up. `wrong` is the AI's first attempt: a plain white
// page that blinks in over three steps while the photo stays put.
function SeaArt({ zoom }: { zoom: number }) {
  return <svg className={styles.art} viewBox="0 0 220 160" preserveAspectRatio="xMidYMid slice" style={{ transform: `scale(${zoom})` }} aria-hidden="true">
    <circle cx="160" cy="46" r="22" fill="#fde68a" />
    <path d="M0 96 Q 30 84 60 96 T 120 96 T 180 96 T 240 96 V160 H0Z" fill="#0ea5e9" opacity=".75" />
    <path d="M0 116 Q 30 104 60 116 T 120 116 T 180 116 T 240 116 V160 H0Z" fill="#0369a1" />
    <path d="M40 92 l10 -22 l10 22z" fill="#f8fafc" opacity=".9" />
  </svg>;
}

function AppScreen({ progress, wrong = false }: { progress: number; wrong?: boolean }) {
  if (wrong) return <WrongScreen progress={progress} />;
  const card = motion.cardRect(progress);
  const body = motion.bodyOpacity(progress);
  const list: CSSProperties = { transform: `scale(${1 - 0.06 * progress})`, opacity: 1 - 0.55 * progress, filter: `blur(${2 * progress}px)` };
  return <div className={styles.screen}>
    <div className={styles.list} style={list}>
      <p className={styles.appBar}><b>여행지</b><small>이번 주 추천</small></p>
      <span className={styles.card} style={{ left: 14, top: 200, width: 192, height: 120, borderRadius: 22 }} data-tone="forest"><b>강릉 솔숲</b></span>
      <span className={styles.card} style={{ left: 14, top: 334, width: 192, height: 70, borderRadius: 22 }} data-tone="city" />
    </div>
    <span className={styles.card} data-open={progress > 0.02} style={{ left: card.x, top: card.y, width: card.width, height: card.height, borderRadius: card.radius, boxShadow: `0 ${8 + 24 * progress}px ${20 + 40 * progress}px rgba(15,23,42,${0.18 + 0.2 * progress})` }} data-tone="sea">
      <span className={styles.hero} style={{ height: 120 + 60 * progress }}><SeaArt zoom={1 + 0.18 * progress} /></span>
      <b style={{ fontSize: 15 + 9 * progress, bottom: 12 + progress * 236 }}>제주 바다</b>
      <i className={styles.back} style={{ opacity: progress, transform: `scale(${0.5 + 0.5 * progress})` }}><ArrowLeft size={14} weight="bold" /></i>
      <i className={styles.heart} style={{ opacity: body, transform: `scale(${0.4 + 0.6 * body})` }}>♥</i>
      <span className={styles.chips} style={{ opacity: body, transform: `translateY(${(1 - body) * 10}px)` }}><em>★ 4.9</em><em>2박 3일</em><em>₩289,000</em></span>
      <span className={styles.body} style={{ opacity: body, transform: `translateY(${(1 - body) * 70}px)` }}><i /><i /><i /><em>예약하기</em></span>
    </span>
  </div>;
}

function WrongScreen({ progress }: { progress: number }) {
  // Three hard steps instead of a curve: 0 → .33 → .66 → 1.
  const stepped = Math.floor(progress * 3 + 0.001) / 3;
  return <div className={styles.screen}>
    <p className={styles.appBar}><b>여행지</b><small>이번 주 추천</small></p>
    <span className={styles.card} style={{ left: 14, top: 70, width: 192, height: 120, borderRadius: 22 }} data-tone="sea"><span className={styles.hero}><SeaArt zoom={1} /></span><b>제주 바다</b></span>
    <span className={styles.card} style={{ left: 14, top: 200, width: 192, height: 120, borderRadius: 22 }} data-tone="forest"><b>강릉 솔숲</b></span>
    <span className={styles.card} style={{ left: 14, top: 334, width: 192, height: 70, borderRadius: 22 }} data-tone="city" />
    {stepped > 0 && <div className={styles.cheap} style={{ opacity: stepped }}>
      <i className={styles.cheapBack}>&lt; 뒤로</i>
      <span className={styles.cheapThumb}><SeaArt zoom={1} /></span>
      <b>제주 바다</b>
      <p>상세 설명</p>
      <i /><i /><i />
      <em>예약하기</em>
    </div>}
  </div>;
}

// A frame thumbnail: the reference phone at that moment.
function FrameShot({ id }: { id: string }) {
  return <svg className={styles.shot} viewBox={`0 0 ${motion.PHONE.width} ${motion.PHONE.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <foreignObject width={motion.PHONE.width} height={motion.PHONE.height}><AppScreen progress={motion.frameProgress(id)} /></foreignObject>
  </svg>;
}

export function MotionExample({ t }: { t: number }) {
  const manual = motion.manualAt(t);
  const input = motion.inputAt(t);
  const keys = motion.keysAt(t);
  const cursor = motion.cursorAt(t);
  const mine = motion.mineAt(t);
  const comparing = motion.comparingAt(t);
  const messages: ChatItem[] = motion.chatAt(t).map((message) => message.role === "user"
    ? { id: message.id, role: "user", text: message.text, images: message.frames.map((id) => <FrameShot key={id} id={id} />) }
    : { ...message, evidence: message.code ? <pre className={styles.code}>{motion.CODE.join("\n")}</pre> : undefined });
  return <>
    <section className={styles.work} style={box(motion.WORK)} aria-label="작업 화면">
      <div className={styles.window} data-shared="true" style={{ left: 20, width: 320 }}>
        <header><DeviceMobile size={14} weight="fill" />Android Emulator · 레퍼런스 앱<em>공유 중</em></header>
      </div>
      <div className={styles.window} style={{ left: 380, width: 320 }}>
        <header><Play size={12} weight="fill" />localhost:5173 · 내 구현</header>
      </div>
      <Phone rect={motion.PHONE_REF} label="레퍼런스" active={comparing}>
        <AppScreen progress={motion.refProgressAt(t)} />
      </Phone>
      <Phone rect={motion.PHONE_MINE} label="내 구현" active={comparing} verdict={motion.wrongComparingAt(t) && t >= motion.BEATS.wrongCompare[0] + 0.6 ? "wrong" : mine.kind === "right" && comparing && t >= motion.SAME_BADGE_AT ? "same" : null}>
        {mine.kind === "idle"
          ? <div className={styles.empty}>아직 애니메이션 없음</div>
          : <AppScreen progress={mine.progress} wrong={mine.kind === "wrong"} />}
      </Phone>
    </section>

    {motion.requestAt(t) && <Request mode={motion.requestAt(t)!} />}

    <ClaudyChat project="travel-app" messages={messages} dropping={input.dropping}
      input={{ text: input.text, typing: input.typing, attachments: input.video ? [<span key="video" className={styles.videoChip}><FileVideo size={18} weight="fill" /></span>] : input.frames.map((id) => <FrameShot key={id} id={id} />) }} />
    {t >= motion.BEATS.videoRejected[0] && t < motion.BEATS.videoRejected[1] && <p className={styles.uploadError} style={{ left: CHAT_INPUT.x, top: CHAT_INPUT.y - 58, width: CHAT_INPUT.width }}>
      <Warning size={16} weight="fill" /><span><b>reference.mp4 · 38MB</b>동영상은 첨부할 수 없어요 · 이미지 파일만</span>
    </p>}
    {manual.visible && <ManualPip state={manual} />}
    {t >= motion.BEATS.board && <Board rows={motion.boardRowsAt(t)} />}

    {manual.dragging && <div className={styles.dragGhost} style={{ left: cursor.x, top: cursor.y }}><FrameShot id={manual.dragging} /></div>}
    {keys && <Keycaps>{keys.keys.map((key, index) => <span key={key} className={styles.keyGroup}>{index > 0 && "+"}<kbd>{key}</kbd></span>)}{keys.note && <span>{keys.note}</span>}</Keycaps>}
    {t < motion.BEATS.board && <Pointer {...cursor} />}
    <Caption caption={motion.captionAt(t)} />
  </>;
}

// 은지's message: full size at the start, then pinned above the windows.
function Request({ mode }: { mode: "big" | "pinned" }) {
  return <section className={styles.request} data-mode={mode} aria-label="기획자 요청">
    <header><SlackLogo size={mode === "big" ? 20 : 14} weight="fill" /><b>은지</b><small>기획 · #앱-리뉴얼</small></header>
    <p>{motion.REQUEST}</p>
    {mode === "big" && <>
      <small className={styles.requestDetail}>{motion.REQUEST_DETAIL}</small>
      <span className={styles.referenceCard}>
        <span className={styles.referenceThumb}><svg viewBox={`0 0 ${motion.PHONE.width} ${motion.PHONE.height}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true"><foreignObject width={motion.PHONE.width} height={motion.PHONE.height}><AppScreen progress={1} /></foreignObject></svg></span>
        <span><b>트립메이트 · 여행지 상세</b><small>레퍼런스 앱 · 카드 펼침 전환</small></span>
      </span>
    </>}
  </section>;
}

function Phone({ rect, label, active, verdict = null, children }: {
  rect: typeof motion.PHONE_REF; label: string; active: boolean; verdict?: "wrong" | "same" | null; children: ReactNode;
}) {
  return <div className={styles.phone} data-active={active} style={{ left: rect.x - motion.WORK.x, top: rect.y - motion.WORK.y, width: rect.width, height: rect.height }}>
    {children}
    <small className={styles.phoneLabel}>{label}{active && <Play size={10} weight="fill" />}</small>
    {verdict === "wrong" && <b className={styles.verdict} data-kind="wrong">✕ 레퍼런스와 다름</b>}
    {verdict === "same" && <b className={styles.verdict} data-kind="same"><Check size={13} weight="bold" />같은 움직임</b>}
  </div>;
}

function ManualPip({ state }: { state: motion.ManualState }) {
  return <PipFrame rect={motion.PIP} mode={state.manual ? "Manual" : null} minimized={state.minimized} pressedQuick={state.quickPressed ? 0 : null}>
    {state.manual && <>
      <p className={styles.stripLabel} style={{ top: 94 }}>대표 화면 · <em>… 를 누르면 0.4초 사이 화면</em></p>
      <div className={styles.strip} style={{ top: motion.STRIP.top }}>
        {motion.stripSlots(state.expanded).map((slot, index) => slot.kind === "gap"
          ? <span key={index} className={styles.gap} data-expanded={slot.expandable && state.expanded} style={{ left: slot.x, width: slot.width }}>…</span>
          : <span key={index} className={styles.frame} data-middle={slot.kind === "middle"}
            data-picked={state.picked.includes(slot.frame!.id)} data-dragging={state.dragging === slot.frame!.id} style={{ left: slot.x, width: slot.width }}>
            <FrameShot id={slot.frame!.id} />
            {state.picked.includes(slot.frame!.id) && <b>{state.picked.indexOf(slot.frame!.id) + 1}</b>}
            <time>{slot.frame!.label}</time>
          </span>)}
      </div>
      {state.expanded && <p className={styles.pickHint}>
        {(["시작", "중간", "끝"] as const).map((label, index) => <span key={label} data-done={state.picked.length > index}>{index + 1} {label}</span>)}
        <small>원본 해상도 · 끌어다 놓기 · 서버 업로드 없음</small>
      </p>}
    </>}
  </PipFrame>;
}

function Board({ rows }: { rows: number }) {
  return <section className={styles.board} aria-label="말과 프레임 비교">
    <header><small>같은 0.4초 전환</small><b>움직임을 AI에게 전달하는 방법</b></header>
    <div className={styles.boardGrid}>
      <span /><em>말로 설명</em><em data-after="true">사이 화면 3장</em>
      {motion.COMPARISON.slice(0, rows).map((row) => <p key={row.label} className={styles.boardRow}>
        <span>{row.label}</span><s>{row.before}</s><b>{row.after}</b>
      </p>)}
    </div>
  </section>;
}
