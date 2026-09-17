import { CaretUp, MagnifyingGlassPlus, X } from "@phosphor-icons/react";
import * as game from "@/lib/usage-example-game";
import { GameScene } from "./game-scene";
import { Caption, ClaudyChat, Keycaps, PipFrame, Pointer, ShutterFlash, box } from "./shared";
import type { ChatItem } from "./shared";
import styles from "./usage-examples.module.css";

// Example 01: the stray yellow square.
const CROP_VIEW = `${game.CROP_BOX.x} ${game.CROP_BOX.y} ${game.CROP_BOX.size} ${game.CROP_BOX.size}`;
const croppedFrame = () => <GameScene hair={false} sun={false} swing={0.5} square viewBox={CROP_VIEW} />;
const RAIL_TIMES = ["03:27:41", "03:27:42", "03:27:43", "03:27:44"];
const MIDDLE_TIMES = ["03:27:42.3", "03:27:42.5"];

export function GameExample({ t }: { t: number }) {
  const state = game.gameAt(t);
  const pip = game.pipAt(t);
  const snip = game.snipAt(t);
  const cursor = game.cursorAt(t);
  const input = game.chatInputAt(t);
  const messages: ChatItem[] = game.chatAt(t).map((message) => message.role === "user"
    ? { ...message, images: message.image ? [croppedFrame()] : [] }
    : message);
  const typing = (t >= game.BEATS.prompt1[0] && t < game.BEATS.send1) || (t >= game.BEATS.prompt2[0] && t < game.BEATS.send2);
  return <>
    <section className={styles.gameWindow} style={box(game.GAME)}>
      {/* The yellow window button goes too; its empty slot is the joke. */}
      <header><i /><i data-gone={!state.sun} /><i /><span>my-rpg — 게임 미리보기</span></header>
      <div className={styles.gameCanvas}>
        <div className={styles.gameZoom} style={{ transform: `scale(${state.zoom})` }}>
          <GameScene hair={state.hair} sun={state.sun} swing={state.swing} square={state.square} slash={state.slash} enemyHit={state.enemyHit} />
        </div>
        {state.zoom > 1.3 && <span className={styles.huh}>???</span>}
        {snip.blocked && <div className={styles.blocked} data-pressed={snip.pressedNow} role="status">
          <b>⏸ 게임 멈춤</b>
          <strong>🚫 입력 무시됨</strong>
          <small>캡처 도구가 화면을 잡고 있어서 공격 키가 게임에 안 들어가요</small>
          <em>공격 키 ×{snip.presses}</em>
        </div>}
      </div>
    </section>

    <ClaudyChat project="my-rpg" messages={messages} dropping={cursor.dragging && t > game.BEATS.drag[1] - 0.4}
      input={{ text: input.text, attachments: input.attachment ? [croppedFrame()] : [], typing }} />

    {pip.visible && <PipWindow pip={pip} t={t} />}

    {snip.overlay && <div className={styles.snipOverlay}>
      <p className={styles.snipToolbar}>✂ 캡처 도구 · 사각형 모드<span>드래그해서 캡처하세요</span></p>
      {snip.selection > 0 && <i className={styles.snipSelection} style={{
        left: game.SNIP_RECT.start.x, top: game.SNIP_RECT.start.y,
        width: (game.SNIP_RECT.end.x - game.SNIP_RECT.start.x) * snip.selection,
        height: (game.SNIP_RECT.end.y - game.SNIP_RECT.start.y) * snip.selection,
      }} />}
    </div>}
    <ShutterFlash opacity={snip.flash} />
    {snip.key && <Keycaps>
      {snip.key === "shortcut" ? <><kbd>⊞ Win</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd></> : <><kbd>Space</kbd><span>공격! ✕ 반응 없음</span></>}
    </Keycaps>}
    {snip.result && <div className={styles.snipResult} role="status">
      <span><GameScene hair sun swing={null} square={false} /></span>
      <div><b>캡처 완료</b><small>노란 네모가 안 찍혔다…</small></div>
    </div>}
    {snip.catch22 && <div className={styles.catch22} role="note">
      <p><span>🗡 공격해야</span><b>→</b><span data-bug="true">🟨 노란 네모가 뜬다</span></p>
      <i>하지만</i>
      <p><span>✂ 캡처를 켜면</span><b>→</b><span data-stop="true">⏸ 공격이 안 된다</span></p>
      <small>그래서 이 버그는 캡처로 보여줄 수가 없다</small>
    </div>}
    {cursor.dragging && <div className={styles.dragGhost} style={{ left: cursor.x, top: cursor.y }}>{croppedFrame()}</div>}
    <Pointer {...cursor} />
    <Caption caption={game.captionAt(t)} />
  </>;
}

function PipWindow({ pip, t }: { pip: game.PipState; t: number }) {
  const origin = { x: game.PIP.x, y: game.PIP.y };
  const slots = game.stripSlots(pip.expanded);
  const crop = game.CROP;
  return <PipFrame rect={game.PIP} mode={pip.manual ? "Manual" : null} minimized={pip.minimized}>
    {pip.manual && <>
      <span className={styles.stripLabel} style={{ left: 16, top: game.STRIP.y - origin.y - 20 }}>화면 선택 <em>선택 0장</em></span>
      <div className={styles.strip} style={{ top: game.STRIP.y - origin.y }}>
        {slots.map((slot) => {
          const style = { left: slot.x - origin.x, width: slot.width };
          if (slot.kind === "gap") return <span key={`gap-${slot.index}`} className={styles.gap} data-expanded={slot.expanded} style={style}>
            {slot.expanded ? <CaretUp size={11} weight="bold" /> : "…"}
          </span>;
          const middle = slot.kind === "middle";
          return <span key={`${slot.kind}-${slot.index}`} className={styles.frame} data-middle={middle}
            data-picked={middle && slot.index === 1 && t >= game.BEATS.enlarge} style={style}>
            <GameScene hair={false} sun={false} swing={slot.frame!.swing} square={slot.frame!.square} />
            {!middle && <b>대표</b>}
            <MagnifyingGlassPlus size={10} />
            <time>{middle ? MIDDLE_TIMES[slot.index] : RAIL_TIMES[slot.index]}</time>
          </span>;
        })}
      </div>
      <span className={styles.download} style={{ top: game.STRIP.y - origin.y + 104 }}>선택한 0장 다운로드</span>
      <span className={styles.dragHint} style={{ top: game.STRIP.y - origin.y + 148 }}>화면을 AI 앱이나 브라우저 대화창으로 직접 드래그할 수 있습니다.</span>
    </>}
    {pip.lightbox && <div className={styles.lightbox}>
      <span className={styles.cropButton} data-pressed={pip.cropMode}
        style={{ left: game.CROP_BUTTON.x - origin.x - 48, top: game.CROP_BUTTON.y - origin.y - 30 - 14 }}>{pip.cropped ? "선택 취소" : "영역 선택"}</span>
      <span className={styles.lightboxClose}><X size={14} /></span>
      {!pip.cropped
        ? <div className={styles.lightboxImage} style={box(game.LIGHTBOX_IMAGE, origin)}>
          <GameScene hair={false} sun={false} swing={0.5} square />
          {pip.crop > 0 && <i className={styles.cropRect} style={{
            left: crop.start.x - game.LIGHTBOX_IMAGE.x, top: crop.start.y - game.LIGHTBOX_IMAGE.y,
            width: (crop.end.x - crop.start.x) * pip.crop, height: (crop.end.y - crop.start.y) * pip.crop,
          }} />}
        </div>
        : <div className={styles.croppedImage} data-dragging={t >= game.BEATS.drag[0]}
          style={box({ x: game.CROPPED_IMAGE.x, y: game.CROPPED_IMAGE.y, width: game.CROPPED_IMAGE.size, height: game.CROPPED_IMAGE.size }, origin)}>
          {croppedFrame()}
        </div>}
      <time className={styles.lightboxTime}>03:27:42.5</time>
    </div>}
  </PipFrame>;
}
