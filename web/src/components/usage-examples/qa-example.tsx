import { ArrowClockwise, ArrowLeft, ArrowRight, Check, CircleNotch, Clock, Copy, Image as ImageIcon, LinkSimple, ListNumbers, Minus, Paperclip, Square, Tag, X } from "@phosphor-icons/react";
import { CHAT_INPUT, SEND_BUTTON } from "@/lib/usage-example-timeline";
import * as qa from "@/lib/usage-example-qa";
import { Caption, ClaudyLogo, Keycaps, PipFrame, Pointer, ShutterFlash, box } from "./shared";
import styles from "./qa-example.module.css";

// Example: the QA engineer files the same bug twice, the old way and with a
// recording link, then compares the two.

// A checkout screen as a thumbnail, for pasted steps and the AI's evidence.
function ShopThumb({ screen, highlight = false }: { screen: qa.ShopScreen; highlight?: boolean }) {
  const bug = screen === "bugTotal" || screen === "bugBadge";
  return <svg viewBox="0 0 200 125" aria-hidden="true">
    <rect width="200" height="125" fill="#fff" />
    <rect x="10" y="10" width="60" height="7" rx="1" fill="#111827" />
    <rect x="10" y="26" width="180" height="20" rx="3" fill="#f3f4f6" />
    <rect x="10" y="52" width="120" height="8" rx="2" fill={qa.couponAppliedFor(screen) ? "#10b981" : "#d1d5db"} />
    <rect x="10" y="66" width="120" height="8" rx="2" fill="#d1d5db" />
    <rect x="10" y="96" width="70" height="12" rx="2" fill="#111827" />
    <rect x="130" y="94" width="60" height="16" rx="2" fill={bug ? "#fee2e2" : "#ecfdf5"} />
    <text x="160" y="106" fill={bug ? "#b91c1c" : "#047857"} fontSize="9" fontWeight="700" textAnchor="middle">{qa.totalFor(screen)}</text>
    {(screen === "modal" || screen === "address") && <><rect width="200" height="125" fill="#0006" /><rect x="50" y="24" width="100" height="78" rx="4" fill="#fff" /></>}
    {highlight && <rect x="124" y="88" width="72" height="28" rx="4" fill="none" stroke="#ff6b22" strokeWidth="3" />}
  </svg>;
}

export function QaExample({ t }: { t: number }) {
  const phase = qa.phaseAt(t);
  const pip = qa.pipAt(t);
  const keys = qa.keysAt(t);
  const capture = qa.captureAt(t);
  const clock = qa.clockAt(t);
  return <>
    <header className={styles.hud} data-phase={phase === "before" ? "before" : "after"}>
      <b>{phase === "before" ? "BEFORE · 기존 방식" : "AFTER · 방금그거뭐였지"}</b>
      <span><Clock size={14} weight="bold" />이슈 작성 <em>{qa.formatClock(clock)}</em></span>
      {phase === "before" && <>
        <span><ImageIcon size={14} weight="bold" />스크린샷 <em>{capture.shots}</em></span>
        <span><ListNumbers size={14} weight="bold" />재현 절차 <em>{capture.steps}단계</em></span>
      </>}
    </header>
    <section className={styles.work} style={box(qa.WORK)} aria-label="체크아웃 화면">
      <Checkout screen={qa.shopAt(t)} callout={qa.calloutAt(t)} />
    </section>
    <Tracker state={qa.trackerAt(t)} />
    {phase === "transition" && <div className={styles.transition}><small>SAME BUG</small><b>같은 버그, 방금그거뭐였지로</b></div>}
    {pip.visible && <LinkPip pip={pip} />}
    {t >= qa.BEATS.board && <Board rows={qa.boardRowsAt(t)} />}

    <ShutterFlash opacity={capture.flash} />
    {keys && <Keycaps>{keys.keys.map((key, index) => <span key={key} className={styles.keyGroup}>{index > 0 && "+"}<kbd>{key}</kbd></span>)}{keys.note && <span>{keys.note}</span>}</Keycaps>}
    {t < qa.BEATS.board && <Pointer {...qa.cursorAt(t)} />}
    <Caption caption={qa.captionAt(t)} />
  </>;
}

function Checkout({ screen, callout }: { screen: qa.ShopScreen; callout: boolean }) {
  const bug = screen === "bugTotal" || screen === "bugBadge";
  const modal = screen === "modal" || screen === "address";
  return <div className={styles.browser}>
    <header className={styles.browserTabs}><span>주문서 · Acme Shop (staging)<X size={11} /></span><em><Minus size={13} /><Square size={11} /><X size={13} /></em></header>
    <div className={styles.addressBar}><ArrowLeft size={15} /><ArrowRight size={15} /><ArrowClockwise size={15} /><span>staging.acme.shop/checkout</span></div>
    <div className={styles.checkout}>
      <h3>주문서</h3>
      <p className={styles.product}><i /><span><b>Everyday Tote Bag</b><small>Sand · 1개</small></span><em>49,000원</em></p>
      <p className={styles.row} style={{ top: 222 - 69 - 20 }}>
        <span>쿠폰</span>
        <em data-applied={couponApplied(screen)} data-flag={screen === "bugBadge" || callout}>{couponApplied(screen) ? "WELCOME20 · 적용됨" : "사용 가능 1장"}</em>
        <b className={styles.action} data-active={couponApplied(screen)}>{couponApplied(screen) ? "적용됨" : "쿠폰 적용"}</b>
      </p>
      <p className={styles.row} style={{ top: 282 - 69 - 20 }}>
        <span>배송지</span>
        <em>{bug || screen === "address" ? "서울 마포구 월드컵북로 21" : "서울 강남구 테헤란로 152"}</em>
        <b className={styles.action}>변경</b>
      </p>
      <div className={styles.total} data-bug={bug}>
        {qa.discountFor(screen) && <p className={styles.discount} data-lost={bug}><span>쿠폰 할인</span><b>{qa.discountFor(screen)}</b></p>}
        <p><span>최종 결제 금액</span>{callout && <s>39,200원</s>}<b>{qa.totalFor(screen)}</b>{bug && <small>할인 미반영</small>}</p>
      </div>
      {callout && <p className={styles.callout}><b>버그</b>쿠폰은 &apos;적용됨&apos;인데 할인이 빠졌어요 · 39,200원 → 49,000원</p>}
    </div>
    {modal && <div className={styles.modal}>
      <section>
        <b>배송지 변경</b>
        {["서울 강남구 테헤란로 152", "서울 마포구 월드컵북로 21"].map((address, index) => <p key={address} data-picked={(screen === "address") === (index === 1)}><i />{address}</p>)}
        <span className={styles.modalSave} style={{ left: qa.MODAL_SAVE.x - qa.WORK.x - 60 - 140, top: qa.MODAL_SAVE.y - qa.WORK.y - 18 - 190 }}>저장</span>
      </section>
    </div>}
  </div>;
}
const couponApplied = qa.couponAppliedFor;

function Tracker({ state }: { state: qa.TrackerState }) {
  const origin = { x: qa.TRACKER.x, y: qa.TRACKER.y };
  return <section className={styles.tracker} style={box(qa.TRACKER)} aria-label="이슈 트래커">
    {state.mode === "blank" ? <div className={styles.blank} /> : <>
      <header>
        <Tag size={16} weight="bold" />
        <b>{state.mode === "form" ? "새 이슈" : state.issue === "before" ? "QA-482" : "QA-483"}</b>
        <small>Acme Shop · 결제</small>
        {state.mode === "issue" && <em className={styles.status} data-status={state.status}>{state.status}</em>}
      </header>
      {state.mode === "form" && state.issue === "before" && <div className={styles.form}>
        <label>제목<span>{state.title}</span></label>
        <label className={styles.steps}>재현 절차
          <div>{state.steps.map((step, index) => <p key={index}>
            {step.shot && <span className={styles.stepShot}><ShopThumb screen={step.shot} /></span>}
            <span>{step.text}{state.typing && index === state.steps.length - 1 && !state.environment && <i className={styles.caret} />}</span>
          </p>)}</div>
        </label>
        <label>환경<span data-empty={!state.environment}>{state.environment || "브라우저 · OS · 서버"}</span></label>
      </div>}
      {state.mode === "form" && state.issue === "after" && <div className={styles.form}>
        <label>제목<span data-empty={!state.title}>{state.title || "이슈 제목"}{state.typing && <i className={styles.caret} />}</span></label>
        <label>재현 기록
          {state.link
            ? <span className={styles.linkCard}><LinkSimple size={18} weight="bold" /><span><b>whatwas · 최근 30초 화면 기록</b><small>화면 12장 · 이벤트 14건 · 환경 정보 포함</small></span></span>
            : <span data-empty="true"><Paperclip size={14} />링크 붙여넣기</span>}
        </label>
        <p className={styles.hint}>재현 절차 · 스크린샷 · 환경 정보는 기록 링크에 포함됩니다.</p>
      </div>}
      {state.mode === "form" && <span className={styles.submit} style={{ left: qa.SUBMIT.x - origin.x - 60, top: qa.SUBMIT.y - origin.y - 18 }}>이슈 등록</span>}
      {state.mode === "issue" && <div className={styles.issue}>
        {state.issue === "before"
          ? <p className={styles.summary}><ListNumbers size={15} />재현 절차 6단계<ImageIcon size={15} />스크린샷 6장<small>{qa.ENVIRONMENT}</small></p>
          : <p className={styles.summary}><LinkSimple size={15} />재현 기록 링크 1개<small>{qa.LINK_URL.replace("https://", "")}</small></p>}
        <div className={styles.comments} style={{ height: CHAT_INPUT.y - origin.y - 120 }}>
          {state.comments.map((comment) => comment.kind === "person"
            ? <div key={comment.id} className={styles.comment} data-me={comment.author === "me"}>
              <i>{comment.author === "me" ? "QA" : "FE"}</i>
              <div><b>{comment.author === "me" ? "나 · QA" : "민준 · 프론트엔드"}</b><p>{comment.text}</p></div>
            </div>
            : <div key={comment.id} className={styles.analysis}>
              <header><ClaudyLogo size={16} /><b>AI 분석</b><small>민준의 에이전트 · 재현 기록 기반</small></header>
              {comment.thinking ? <p className={styles.thinking}>재현 기록 확인 중…</p> : <p>{comment.text}</p>}
              {comment.tools.map((tool) => <code key={tool}>{tool}</code>)}
              {comment.evidence && <span className={styles.evidence}><ShopThumb screen="bugTotal" highlight /><small>01:02:11 · 배송지 저장 직후</small></span>}
              {comment.done && <p>{comment.done}</p>}
            </div>)}
        </div>
      </div>}
      {state.mode === "issue" && state.issue === "before" && <div className={styles.input} style={box(CHAT_INPUT, origin)}>
        <span data-empty={!state.input}>{state.input || "댓글 남기기"}{state.typing && <i className={styles.caret} />}</span>
        <b style={{ left: SEND_BUTTON.x - CHAT_INPUT.x - 30, top: SEND_BUTTON.y - CHAT_INPUT.y - 14 }}>댓글</b>
      </div>}
    </>}
  </section>;
}

function Board({ rows }: { rows: number }) {
  return <section className={styles.board} aria-label="작업 비교">
    <header><small>같은 버그 · 같은 QA 엔지니어</small><b>이슈 한 건을 남기는 비용</b></header>
    <div className={styles.boardGrid}>
      <span /><em>기존 방식</em><em data-after="true">방금그거뭐였지</em>
      {qa.COMPARISON.slice(0, rows).map((row) => <p key={row.label} className={styles.boardRow}>
        <span>{row.label}</span><s>{row.before}</s><b>{row.after}</b>
      </p>)}
    </div>
  </section>;
}

function LinkPip({ pip }: { pip: qa.PipState }) {
  const origin = { x: qa.PIP.x, y: qa.PIP.y };
  return <PipFrame rect={qa.PIP} mode={pip.link ? "Agent Link" : null} minimized={pip.minimized} pressedQuick={pip.quickPressed ? 1 : null}>
    <p className={styles.pipRow} style={{ top: 104 }}><span>전송 구간 <b>최근 30초</b></span><span>링크 20분 유효</span></p>
    <span className={styles.exportButton} data-busy={pip.exporting} style={{ left: 16, right: 16, top: qa.PIP_EXPORT.y - origin.y - 18 }}>
      {pip.exporting ? <CircleNotch className={styles.spin} size={15} /> : <LinkSimple size={15} />}AI Context 생성
    </span>
    {pip.exported && <>
      <p className={styles.pipSuccess} style={{ top: 184 }}><Check size={13} weight="bold" />링크 준비됨 · 오전 01:22 만료</p>
      <p className={styles.pipSteps} style={{ top: 206 }}>이슈나 AI에 이 링크를 붙여넣으세요.</p>
      <p className={styles.pipPrompt} style={{ top: 228 }}>{qa.LINK_URL}</p>
      <span className={styles.copyButton} data-copied={pip.copied} style={{ left: 16, right: 16, top: qa.COPY_BUTTON.y - origin.y - 18 }}>
        {pip.copied ? <Check size={14} /> : <Copy size={14} />}{pip.copied ? "복사되었습니다" : "링크 복사"}
      </span>
    </>}
  </PipFrame>;
}
