import { Check, ClosedCaptioning, CornersOut, FileVideo, FrameCorners, MagnifyingGlass, MicrophoneSlash, Play, VideoCamera, Warning, X } from "@phosphor-icons/react";
import { CHAT_INPUT } from "@/lib/usage-example-timeline";
import * as meet from "@/lib/usage-example-meeting";
import { Caption, ClaudyChat, Keycaps, PipFrame, Pointer, ShutterFlash, box } from "./shared";
import type { ChatItem } from "./shared";
import styles from "./meeting-example.module.css";

// Example: the planner in a video meeting (Manual). The chart that flashed
// by is found between frames, cropped without faces or chat, and dropped in.

const PEOPLE = [["팀장", "#f97316", true], ["지수", "#6366f1", false], ["현우", "#0ea5e9", false], ["나", "#10b981", false]] as const;

// The shared slide, drawn in meeting-window units (720×600).
function SlideContent({ slide }: { slide: meet.Slide }) {
  const { x, y, width, height } = meet.SLIDE;
  const cx = x + meet.CHART.x;
  const cy = y + meet.CHART_CONTENT_TOP;
  return <g>
    <rect x={x} y={y} width={width} height={height} rx="6" fill="#ffffff" />
    {slide === "growth" && <>
      <text x={x + 28} y={y + 48} fontSize="22" fontWeight="800" fill="#111827">주간 그로스 리포트</text>
      <text x={x + 28} y={y + 110} fontSize="54" fontWeight="900" fill="#16a34a">+12%</text>
      <text x={x + 28} y={y + 140} fontSize="15" fill="#6b7280">신규 가입 · 전주 대비</text>
      {[0, 1, 2, 3, 4, 5, 6].map((index) => <rect key={index} x={x + 260 + index * 34} y={y + 270 - (60 + index * 22)} width="22" height={60 + index * 22} rx="3" fill="#86efac" />)}
    </>}
    {slide === "chart" && <>
      <text x={x + 28} y={y + 40} fontSize="20" fontWeight="800" fill="#111827">결제 전환율 (주간)</text>
      <text x={cx + 8} y={cy + 30} fontSize="36" fontWeight="900" fill="#dc2626">2.4%</text>
      <text x={cx + 112} y={cy + 30} fontSize="15" fill="#6b7280">지난주 3.2% · −0.8%p</text>
      <polyline points={`${cx + 10},${cy + 80} ${cx + 110},${cy + 76} ${cx + 210},${cy + 84} ${cx + 310},${cy + 118} ${cx + 410},${cy + 150}`} fill="none" stroke="#dc2626" strokeWidth="5" strokeLinecap="round" />
      {[["장바구니", 92, 90], ["결제 정보", 58, 34], ["완료", 40, 30]].map(([label, desktop, mobile], index) => <g key={label}>
        <text x={cx + 10 + index * 160} y={cy + 196} fontSize="13" fill="#374151">{label}</text>
        <rect x={cx + 10 + index * 160} y={cy + 206} width={Number(desktop)} height="12" rx="2" fill="#93c5fd" />
        <rect x={cx + 10 + index * 160} y={cy + 224} width={Number(mobile)} height="12" rx="2" fill={index === 1 ? "#dc2626" : "#fca5a5"} />
      </g>)}
      <text x={cx + 10} y={cy + 256} fontSize="11" fill="#6b7280">■ 데스크톱  ■ 모바일</text>
    </>}
    {slide === "plan" && <>
      <text x={x + 28} y={y + 48} fontSize="22" fontWeight="800" fill="#111827">다음 주 계획</text>
      {["온보딩 이메일 A/B 테스트", "추천 코드 리워드 개편", "iOS 위젯 출시"].map((line, index) => <text key={line} x={x + 40} y={y + 110 + index * 48} fontSize="20" fill="#374151">{index + 1}. {line}</text>)}
    </>}
  </g>;
}

// The whole meeting window as an image: frames, the lightbox and the crop.
function MeetingShot({ slide, viewBox = "0 0 720 600", align = "xMidYMid" }: { slide: meet.Slide; viewBox?: string; align?: string }) {
  return <svg viewBox={viewBox} preserveAspectRatio={`${align} slice`} aria-hidden="true">
    <rect width="720" height="600" fill="#1b1d24" />
    <rect width="720" height="30" fill="#111318" />
    <SlideContent slide={slide} />
    {PEOPLE.map(([name, color], index) => <g key={name}>
      <rect x="564" y={42 + index * 84} width="144" height="76" rx="6" fill="#2a2d36" />
      <circle cx="636" cy={72 + index * 84} r="18" fill={color} />
      <text x="572" y={112 + index * 84} fontSize="11" fill="#e5e7eb">{name}</text>
    </g>)}
    <rect x="12" y="384" width="418" height="116" rx="6" fill="#111318" />
    <rect x="440" y="384" width="268" height="204" rx="6" fill="#111318" />
    {[410, 440, 470].map((row) => <rect key={row} x="452" y={row} width="200" height="10" rx="2" fill="#374151" />)}
  </svg>;
}

export function MeetingExample({ t }: { t: number }) {
  const manual = meet.manualAt(t);
  const recording = meet.recordingAt(t);
  const keys = meet.keysAt(t);
  const cursor = meet.cursorAt(t);
  const input = meet.aiInputAt(t);
  const messages: ChatItem[] = meet.aiChatAt(t).map((message) => message.role === "user"
    ? { id: message.id, role: "user", text: message.text, images: message.image ? [<ChartCrop key="chart" />] : [] }
    : { id: message.id, role: "claudy", text: message.text, thinking: message.thinking, tools: [], done: message.done });
  return <>
    <section className={styles.work} style={box(meet.WORK)} aria-label="화상 회의">
      <Meeting t={t} />
      {t >= meet.BEATS.snipResult[0] && t < meet.BEATS.snipResult[1] && <div className={styles.snipResult}>
        <span><MeetingShot slide="plan" /></span><p><b>캡처됨</b><small>…이미 다음 장</small></p>
      </div>}
    </section>
    <ClaudyChat project="주간 회의" messages={messages} dropping={input.dropping}
      input={{ text: input.text, typing: input.typing, attachments: input.image ? [<ChartCrop key="chart" />] : [] }} />
    {recording.rejected && <p className={styles.uploadError} style={{ left: CHAT_INPUT.x, top: CHAT_INPUT.y - 58, width: CHAT_INPUT.width }}>
      <Warning size={16} weight="fill" /><span><b>zoom_recording_0914.mp4 · 1.2GB</b>동영상은 첨부할 수 없어요 · 이미지 파일만 (최대 20MB)</span>
    </p>}
    {recording.visible && <RecordingCard state={recording} />}
    {manual.visible && <ManualPip state={manual} />}
    {t >= meet.BEATS.board && <Board step={meet.boardStepAt(t)} />}

    {recording.dragging && <div className={styles.fileGhost} style={{ left: cursor.x, top: cursor.y }}><FileVideo size={22} weight="fill" />zoom_recording_0914.mp4</div>}
    {manual.dragging && <div className={styles.dragGhost} style={{ left: cursor.x, top: cursor.y }}><ChartCrop /></div>}
    <ShutterFlash opacity={Math.max(0, 1 - Math.abs(t - (meet.BEATS.snip + 0.2)) / 0.12)} />
    {keys && <Keycaps>{keys.keys.map((key, index) => <span key={key} className={styles.keyGroup}>{index > 0 && "+"}<kbd>{key}</kbd></span>)}{keys.note && <span>{keys.note}</span>}</Keycaps>}
    {t < meet.BEATS.board && <Pointer {...cursor} />}
    <Caption caption={meet.captionAt(t)} />
  </>;
}

function ChartCrop() {
  const { x, y } = meet.SLIDE;
  const { CHART } = meet;
  return <MeetingShot slide="chart" viewBox={`${x + CHART.x} ${y + CHART.y} ${CHART.width} ${CHART.height}`} align="xMinYMin" />;
}

function Meeting({ t }: { t: number }) {
  const slide = meet.slideAt(t);
  const chat = meet.meetingChatAt(t);
  return <div className={styles.meeting}>
    <header><VideoCamera size={15} weight="fill" /><b>주간 그로스 회의</b><small>팀장님이 화면을 공유하는 중</small><em>42:18</em></header>
    <div className={styles.slide} style={box(meet.SLIDE)}>
      <svg viewBox={`${meet.SLIDE.x} ${meet.SLIDE.y} ${meet.SLIDE.width} ${meet.SLIDE.height}`} key={slide} aria-label={`공유 중인 슬라이드: ${slide}`}><SlideContent slide={slide} /></svg>
    </div>
    {PEOPLE.map(([name, color, speaking], index) => <span key={name} className={styles.tile} data-speaking={speaking} style={{ top: 42 + index * 84 }}>
      <i style={{ background: color }}>{name.slice(0, 1)}</i><small>{name}{!speaking && <MicrophoneSlash size={11} />}</small>
    </span>)}
    <p className={styles.liveCaption}><ClosedCaptioning size={16} weight="fill" /><span><b>팀장</b>{meet.liveCaptionAt(t)}</span></p>
    <div className={styles.meetChat}>
      <b>회의 채팅</b>
      {chat.messages.map((message) => <p key={message.id} data-me={message.me}><small>{message.name}</small>{message.text}</p>)}
      <span className={styles.meetInput} data-empty={!chat.input}>{chat.input || "모두에게 메시지 보내기"}{chat.typing && <i className={styles.caret} />}</span>
    </div>
  </div>;
}

function RecordingCard({ state }: { state: meet.RecordingState }) {
  const origin = { x: meet.REC.x, y: meet.REC.y };
  return <section className={styles.recording} style={box(meet.REC)} aria-label="녹화본으로 찾는다면">
    <header><FileVideo size={16} weight="fill" /><b>녹화해뒀다면?</b><span className={styles.fileChip} style={{ left: meet.REC_FILE.x - origin.x - 90, top: meet.REC_FILE.y - origin.y - 14 }}>zoom_recording_0914.mp4</span></header>
    <div className={styles.player}>
      <MeetingShot slide={state.seconds >= meet.CHART_AT_SECONDS - 2 && state.seconds <= meet.CHART_AT_SECONDS + 2 ? "chart" : state.seconds % 90 < 45 ? "growth" : "plan"} />
      {state.searching && <p className={styles.searching}><MagnifyingGlass size={16} weight="bold" />1초짜리 장면 찾는 중…</p>}
    </div>
    <div className={styles.scrubber} style={{ left: meet.SCRUB.left - origin.x, top: meet.SCRUB.y - origin.y, width: meet.SCRUB.width }}>
      <i style={{ width: `${(state.seconds / meet.RECORDING_SECONDS) * 100}%` }} />
    </div>
    <p className={styles.clock}><Play size={12} weight="fill" />{meet.formatTime(state.seconds)} / {meet.formatTime(meet.RECORDING_SECONDS)}</p>
  </section>;
}

function ManualPip({ state }: { state: meet.ManualState }) {
  return <PipFrame rect={meet.PIP} mode={state.manual ? "Manual" : null} minimized={state.minimized} pressedQuick={state.quickPressed ? 0 : null}>
    {state.manual && !state.lightbox && <>
      <p className={styles.stripLabel} style={{ top: 104 - 16 }}>대표 화면 · <em>… 를 누르면 사이 화면</em></p>
      <div className={styles.strip} style={{ top: meet.STRIP.top }}>
        {meet.stripSlots(state.expanded).map((slot, index) => slot.kind === "gap"
          ? <span key={index} className={styles.gap} data-expanded={slot.expandable && state.expanded} style={{ left: slot.x, width: slot.width }}>…</span>
          : <span key={index} className={styles.frame} data-middle={slot.kind === "middle"} style={{ left: slot.x, width: slot.width }}>
            <MeetingShot slide={slot.frame!.slide} /><time>{slot.frame!.time}</time>
          </span>)}
      </div>
    </>}
    {state.lightbox && <div className={styles.lightbox}>
      <span className={styles.cropButton} data-pressed={state.cropMode || state.cropped} style={{ left: meet.CROP_BUTTON.x - meet.PIP.x - 48, top: meet.CROP_BUTTON.y - meet.PIP.y - 14 - 30 }}>
        <FrameCorners size={13} />{state.cropped ? "선택 취소" : "영역 선택"}
      </span>
      <span className={styles.lightboxClose}><X size={14} /></span>
      {!state.cropped && <span className={styles.lightboxImage} style={box(meet.LIGHTBOX, { x: meet.PIP.x, y: meet.PIP.y + 30 })}>
        <MeetingShot slide="chart" />
        {state.privacy && <>
          <b className={styles.privacy} style={{ left: `${(560 / 720) * 100}%`, top: "6%", width: "21%", height: "57%" }}>얼굴</b>
          <b className={styles.privacy} style={{ left: "1%", top: "63%", width: "98%", height: "36%" }}>채팅 · 자막</b>
        </>}
      </span>}
      {state.cropBox && <span className={styles.cropRect} style={box(state.cropBox, { x: meet.PIP.x, y: meet.PIP.y + 30 })} />}
      {state.cropped && <span className={styles.cropped} data-dragging={state.dragging} style={box(meet.CROPPED, { x: meet.PIP.x, y: meet.PIP.y + 30 })}><ChartCrop /></span>}
      <p className={styles.lightboxTime}>{state.cropped ? <><Check size={12} weight="bold" />차트만 · 원본 해상도 · 서버 업로드 없음</> : "14:02:34.6 · 사이 화면"}</p>
    </div>}
  </PipFrame>;
}

function Board({ step }: { step: number }) {
  return <section className={styles.board} aria-label="녹화와 비교">
    <header><b>회의 중 지나간 1초를 AI에게 보내려면</b></header>
    <div className={styles.path} data-kind="recording">
      <small><FileVideo size={15} weight="fill" />녹화해뒀다면</small>
      <ol>{meet.RECORDING_PATH.map((label, index) => step > index && <li key={label} data-fail={index === meet.RECORDING_PATH.length - 1}>
        {label}{index === meet.RECORDING_PATH.length - 1 && <em><X size={12} weight="bold" />영상 불가</em>}
      </li>)}</ol>
    </div>
    <div className={styles.path} data-kind="manual">
      <small><CornersOut size={15} weight="bold" />Manual · 회의 중 바로</small>
      <ol>{meet.MANUAL_PATH.map((label, index) => step > meet.RECORDING_PATH.length + index && <li key={label}>{label}</li>)}
        {step > meet.RECORDING_PATH.length + meet.MANUAL_PATH.length && <li data-done="true"><Check size={13} weight="bold" />약 10초</li>}
      </ol>
    </div>
  </section>;
}
