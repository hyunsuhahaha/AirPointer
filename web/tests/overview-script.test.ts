import assert from "node:assert/strict";
import test from "node:test";
import {
  FLASH_CUES, LOG_RAIN, LOG_VANISH_AT, RANT, STAGES, TIMELINE, TOAST_CUES,
  cameraAt, nextSceneTime, revealedChars, sceneAt, timeForChar,
} from "../src/lib/overview-script.ts";

test("하소연은 다섯 단계로 끊김 없이 끝까지 드러나고 1막은 20초 안에 끝난다", () => {
  assert.equal(STAGES.length, 5);
  assert.equal(STAGES[0].from, 0);
  assert.equal(STAGES.at(-1)!.to, RANT.length);
  for (let index = 1; index < STAGES.length; index++) {
    assert.equal(STAGES[index].from, STAGES[index - 1].to);
    assert.equal(STAGES[index].start, STAGES[index - 1].end);
  }
  assert.ok(RANT.endsWith("병원비가 더 나옴"));
  assert.ok(TIMELINE.act1End <= 20.5, `act 1 lasts ${TIMELINE.act1End}s`);
  assert.equal(revealedChars(0), 0);
  assert.equal(revealedChars(TIMELINE.act1End), RANT.length);
  let previous = 0;
  for (let t = 0; t <= TIMELINE.act1End; t += 0.05) {
    const shown = revealedChars(t);
    assert.ok(shown >= previous, `reveal went backwards at ${t}`);
    previous = shown;
  }
});

test("글자 등장 시각은 드러나는 속도의 역함수이고 효과 타이밍이 모두 1막 안에 있다", () => {
  for (const index of [10, 200, 900, 1500, RANT.length - 5]) {
    assert.ok(Math.abs(revealedChars(timeForChar(index)) - index) <= 1, `index ${index}`);
  }
  const cues = [...FLASH_CUES, ...TOAST_CUES.map((cue) => cue.at), LOG_RAIN.start, LOG_RAIN.end, LOG_VANISH_AT];
  assert.equal(FLASH_CUES.length, 9);
  assert.equal(TOAST_CUES.length, 7);
  for (const at of cues) assert.ok(Number.isFinite(at) && at > 0 && at <= TIMELINE.act1End, `cue ${at}`);
  assert.ok(LOG_RAIN.start < LOG_RAIN.end && LOG_RAIN.end < LOG_VANISH_AT);
});

test("카메라는 1막에 왼쪽 그림, 2막에 오른쪽 그림만 비추고 마지막에 전체를 담는다", () => {
  const aspect = 16 / 9;
  for (const ratio of [aspect, 9 / 19.5]) {
    for (let t = 0; t < TIMELINE.transitionEnd; t += 0.1) {
      const { cx, w, ax } = cameraAt(t, ratio);
      assert.ok(cx + (1 - ax) * w <= 630, `rant camera reaches the logo at ${t} (${ratio})`);
    }
    for (let t = TIMELINE.transitionEnd; t < TIMELINE.act2End; t += 0.1) {
      const { cx, w, ax } = cameraAt(t, ratio);
      assert.ok(cx - ax * w >= 925 && cx + (1 - ax) * w <= 1536, `relief camera leaves the right panel at ${t} (${ratio})`);
    }
  }
  const end = cameraAt(TIMELINE.end, aspect);
  assert.ok(end.w >= 1536);
  assert.deepEqual([sceneAt(0), sceneAt(TIMELINE.act1End + 0.1), sceneAt(TIMELINE.transitionEnd + 0.1), sceneAt(TIMELINE.end)], ["rant", "transition", "relief", "finale"]);
  assert.equal(nextSceneTime(1), TIMELINE.act1End);
  assert.equal(nextSceneTime(TIMELINE.transitionEnd + 1), TIMELINE.finaleStart);
});
