// Timing script for the "프로젝트 개요" cinematic. Everything here is a pure
// function of the playhead `t` (seconds) so the overlay can pause, skip and
// be tested without a clock.

export const RANT = "매번 AI한테 오류 난 거나 내가 겪은 일 그리고 내 화면이 대체 왜 이런지 알 수가 없을 때 말로 설명하자니 애매하고 답답해서 캡처 도구 켜서 화면 캡처하고 복사 붙여넣기하려는데 캡처 도구 켰더니 화면 사라져 있고, 또 다시 증상 나올 때까지 기다렸다가 캡처 도구 대기했는데 타이밍 놓쳐 가지고 캡처 못 하고 화만 엄청 났다가 어찌어찌 캡처하는 데 성공했는데 또 오류가 나 가지고 캡처 도구 다시 켜서 또 캡처하고 복사 붙여넣기하고, 지금 뭐가 문제인지 또 한참 설명하고 있는데, 하필 그 에러 메시지가 잠깐 떴다가 찰나에 사라져서 못 잡았다가 다시 보려고 똑같은 조작 해봤다가 안 뜨다가 몇 번 더 해봤다가 또 안 뜨다가 캡처 도구 켜놓고 화면 뚫어져라 기다렸다가 아무 일도 안 생기다가 그냥 포기하고 다른 거 하고 있다가 갑자기 또 떠서 놓쳤다가 다시 해봤다가 또 안 뜨다가 이번엔 진짜 잡는다고 캡처 도구 계속 켜놓고 반응 기다리다가 한참 동안 안 뜨다가 또 놓쳤다가 이번엔 화면만 뚫어져라 쳐다보면서 똑같은 작업 계속 반복했다가 안 뜨다가 잠깐 딴짓한 사이에 또 떴다가 사라지고 겨우 뭔가 캡처했다가 정작 필요한 에러 문구는 이미 사라져 있고 결과 화면만 덩그러니 찍혀 있다가 AI한테 아까 분명 뭐가 떴는데 정확히는 못 봤다고 어설프게 설명하다가 AI가 이해 못해서 애꿎은 멀쩡한 코드 수정해놓고 내 크레딧과 시간은 이미 사라져 있고 로그 보여달라 해서 로그 찾다가 다른 거 보다 원래 뭐 물어보려 했는지도 까먹고, 로그 위치 알려줬더니 경로 입력하다 오타 나서 폴더 안 열린다고 또 캡처해서 보내고 오타 수정해서 들어갔더니 로그 파일이 10개가 넘게 있어서 제일 최근 파일 열었더니 외계어 같은 문자만 빽빽하게 차 있어서 어디부터 어디까지 긁어서 줘야 할지도 몰라 가지고 일단 대충 전체 선택해서 AI 창에 넣었더니 글자 수 제한 걸려서 안 들어간다고 징징대길래 메모장 열어서 쪼개서 넣다가 첫 번째 파트 보냈더니 문맥이 끊겨서 모르겠다고 전체를 파일로 첨부하라 해서 첨부 버튼 눌렀더니 파일 용량 너무 크다고 거절당하고 용량 줄이겠다고 압축 소프트웨어 켜서 ZIP으로 묶어서 올렸더니 압축 파일은 읽을 수 없다고 내용물 풀어서 텍스트만 달라고 하고 열받아서 압축 풀고 다시 반으로 나눠서 두 번째 파트 올렸더니 이번엔 아까 첫 번째 파트랑 다른 대화창에 올려서 이전 내용 기억 못 하고 처음부터 다시 설명하라 해서 대화 목록 뒤져서 이전 대화 찾아 들어가서 다시 올렸더니 이번엔 아까 올린 로그는 이전 버전 로그고 지금 발생한 에러 로그가 아니라면서 실시간 로그를 보라길래 터미널 명령어를 알려주는데 명령어 복사해서 붙여넣었더니 권한 없다고 거부당하고 sudo 붙여서 다시 실행했더니 비밀번호 입력하라는데 타이핑해도 화면에 아무것도 안 찍혀서 먹통 된 줄 알고 계속 엔터 누르다가 오류 나고 비밀번호 겨우 제대로 치고 들어갔더니 화면에 로그가 초당 100줄씩 미친 듯이 올라가서 스크롤 잡지도 못하고 눈으로 쫓아가다가 정지 명령어가 뭔지 몰라 또 AI한테 물어봤더니 Ctrl+C 누르라 해서 누르고 스크롤 위로 올려서 아까 그 오류 찾아보려 했더니 터미널 버퍼 제한 걸려서 아까 떴던 부분은 이미 위로 날아가서 사라져 있고 다시 처음부터 그 현상 재현하려고 또 그 작업 반복하고 있다가 이번엔 아까보다 더 빨리 사라져서 허탈하게 모니터만 멍하니 바라보다가 내가 지금 이걸 왜 시작했는지 현타 와서 AI에게 화풀이하려는데 크레딧 모자라서 화풀이하지도 못하고 애꿎은 내 머리카락만 빠지다가 개발을 시작하게 된 걸 후회하다가 지금까지의 내 인생이 잘못 살아온 것 같이 느껴지고 인스타그램 들어갔는데 나만 빼고 다 잘 먹고 잘살고 있는데 내가 할 수 있는 건 애꿎은 모니터 앞에서 키보드질밖에 없고 대충 누워서 릴스나 슥슥 넘기다가 인생을 잘못 사는 것 같아서 결국 다시 모니터 앞에 앉아서 거북목 대충 빼들고 건강과 수명을 갈아가면서 개발하다가 병원비가 더 나옴";

// The rant is revealed in five beats that keep speeding up: the first is
// readable, the last floods the screen. `ease` > 1 accelerates within a beat;
// `hold` is a pause after the beat finishes. RANT_SPEED scales every beat.
const RANT_SPEED = 1.43;
type StageSpec = { id: string; endsAfter: string; duration: number; hold: number; ease: number };
const STAGE_SPECS: StageSpec[] = [
  { id: "intro", endsAfter: "복사 붙여넣기하려는데 ", duration: 5, hold: 0.3, ease: 1 },
  { id: "missed", endsAfter: "결과 화면만 덩그러니 찍혀 있다가 ", duration: 8, hold: 0, ease: 1.6 },
  { id: "logs", endsAfter: "Ctrl+C 누르라 해서 누르고 ", duration: 6, hold: 0, ease: 1.8 },
  { id: "gone", endsAfter: "모니터만 멍하니 바라보다가 ", duration: 3.2, hold: 1.1, ease: 0.7 },
  { id: "spiral", endsAfter: RANT, duration: 2.6, hold: 1.15, ease: 2 },
];

export type Stage = StageSpec & { from: number; to: number; start: number; end: number };

export const STAGES: Stage[] = (() => {
  let from = 0;
  let start = 0.6;
  return STAGE_SPECS.map((spec) => {
    const to = spec.endsAfter === RANT ? RANT.length : RANT.indexOf(spec.endsAfter, from) + spec.endsAfter.length;
    if (to <= from) throw new Error(`overview stage "${spec.id}" boundary not found`);
    const duration = spec.duration / RANT_SPEED;
    const hold = spec.hold / RANT_SPEED;
    const stage = { ...spec, duration, hold, from, to, start, end: start + duration + hold };
    from = to;
    start = stage.end;
    return stage;
  });
})();

export const TIMELINE = (() => {
  const act1End = STAGES[STAGES.length - 1].end;
  const transitionEnd = act1End + 4.2;
  const act2End = transitionEnd + 8;
  const finaleStart = act2End;
  return { act1End, transitionEnd, act2End, finaleStart, end: finaleStart + 3.2 };
})();

export type Scene = "rant" | "transition" | "relief" | "finale";
export function sceneAt(t: number): Scene {
  if (t < TIMELINE.act1End) return "rant";
  if (t < TIMELINE.transitionEnd) return "transition";
  if (t < TIMELINE.act2End) return "relief";
  return "finale";
}

export function stageAt(t: number): Stage {
  return STAGES.find((stage) => t < stage.end) ?? STAGES[STAGES.length - 1];
}

export function revealedChars(t: number): number {
  for (const stage of STAGES) {
    if (t >= stage.end) continue;
    const u = Math.min(1, Math.max(0, (t - stage.start) / stage.duration));
    return Math.round(stage.from + (stage.to - stage.from) * u ** stage.ease);
  }
  return RANT.length;
}

// Inverse of revealedChars: when character `index` appears.
export function timeForChar(index: number): number {
  const stage = STAGES.find((candidate) => index < candidate.to) ?? STAGES[STAGES.length - 1];
  const p = Math.min(1, Math.max(0, (index - stage.from) / (stage.to - stage.from)));
  return stage.start + stage.duration * p ** (1 / stage.ease);
}

function cuesFor(phrase: string) {
  const times: number[] = [];
  for (let index = RANT.indexOf(phrase); index >= 0; index = RANT.indexOf(phrase, index + 1)) {
    times.push(timeForChar(index + phrase.length));
  }
  return times;
}

// Error dialogs that flash and vanish every time the capture is missed.
export const FLASH_CUES = ["화면 사라져 있고", "안 뜨다가", "놓쳤다가", "떴다가 사라지고"].flatMap(cuesFor).sort((a, b) => a - b);

// Rejections the AI detour keeps running into.
export const TOAST_CUES = [
  { phrase: "처음부터 다시 설명하라", text: "이전 대화 내용을 기억하지 못합니다" },
  { phrase: "글자 수 제한", text: "메시지가 너무 깁니다 (최대 글자 수 초과)" },
  { phrase: "파일 용량 너무 크다고", text: "파일이 너무 큽니다" },
  { phrase: "압축 파일은 읽을 수 없다고", text: "ZIP 파일은 읽을 수 없습니다" },
  { phrase: "권한 없다고", text: "Permission denied" },
  { phrase: "비밀번호 입력하라는데", text: "[sudo] password for dev:" },
  { phrase: "크레딧 모자라서", text: "크레딧이 부족합니다" },
].map((cue) => ({ ...cue, at: cuesFor(cue.phrase)[0] })).sort((a, b) => a.at - b.at);

// The log flood keeps running for a beat after "Ctrl+C" (the reaction is
// late), freezes, then the lines fly off when the buffer loses them.
const CTRL_C_AT = cuesFor("Ctrl+C 누르라")[0];
export const LOG_RAIN = { start: cuesFor("초당 100줄")[0], end: CTRL_C_AT + 1 };
export const LOG_VANISH_AT = Math.max(cuesFor("이미 위로 날아가서 사라져 있고")[0], LOG_RAIN.end + 0.3);

// Camera over the 1536×1024 artwork: (cx, cy) is the focus point, drawn at
// `ax` of the viewport width, and w is the visible width, all in image
// pixels, so the visible span is [cx - ax·w, cx + (1 - ax)·w]. During the
// rant the focus sits right of centre so the left of the screen (behind the
// text) can run past the picture's edge instead of zooming in further; it
// must stay left of the logo at x 635. Relief stays right of the logo's
// right end (x 925), since the logo also reaches into the right panel. The
// finale pulls back to the whole picture.
export type Camera = { cx: number; cy: number; w: number; ax: number };
type Key = Omit<Camera, "ax"> & { t: number };
const RANT_AX = 0.6;

export const ART = { width: 1536, height: 1024 };

const RANT_KEYS: Key[] = [
  { t: 0, cx: 270, cy: 230, w: 900 },
  { t: STAGES[1].start, cx: 280, cy: 290, w: 860 },
  { t: STAGES[2].start, cx: 320, cy: 470, w: 760 },
  { t: STAGES[3].start, cx: 300, cy: 580, w: 820 },
  { t: STAGES[4].start, cx: 270, cy: 800, w: 900 },
  { t: TIMELINE.act1End, cx: 340, cy: 830, w: 700 },
];
const RELIEF_KEYS: Key[] = [
  { t: TIMELINE.transitionEnd, cx: 1230, cy: 300, w: 610 },
  { t: TIMELINE.transitionEnd + 2.8, cx: 1236, cy: 380, w: 590 },
  { t: TIMELINE.transitionEnd + 4.6, cx: 1250, cy: 470, w: 560 },
  { t: TIMELINE.act2End, cx: 1230, cy: 820, w: 610 },
];

const smooth = (u: number) => u * u * (3 - 2 * u);

function interpolate(keys: Key[], t: number): Omit<Camera, "ax"> {
  if (t <= keys[0].t) return keys[0];
  for (let index = 1; index < keys.length; index++) {
    const [a, b] = [keys[index - 1], keys[index]];
    if (t <= b.t) {
      const u = smooth((t - a.t) / (b.t - a.t));
      return { cx: a.cx + (b.cx - a.cx) * u, cy: a.cy + (b.cy - a.cy) * u, w: a.w + (b.w - a.w) * u };
    }
  }
  return keys[keys.length - 1];
}

// `aspect` is viewport width / height; the finale fits the whole artwork.
export function cameraAt(t: number, aspect: number): Camera {
  const scene = sceneAt(t);
  // Portrait screens are too narrow for the offset framing: centre each panel.
  if (aspect < 1 && scene !== "finale") {
    const key = scene === "relief" ? interpolate(RELIEF_KEYS, t) : interpolate(RANT_KEYS, t);
    return scene === "relief" ? { cx: 1230, cy: key.cy, w: 610, ax: 0.5 } : { cx: 315, cy: key.cy, w: 630, ax: 0.5 };
  }
  if (scene === "rant" || scene === "transition") return { ...interpolate(RANT_KEYS, t), ax: RANT_AX };
  const relief = { ...interpolate(RELIEF_KEYS, t), ax: 0.5 };
  if (scene === "relief") return relief;
  const whole = { cx: ART.width / 2, cy: ART.height / 2, w: Math.max(ART.width, ART.height * aspect) };
  const u = smooth(Math.min(1, (t - TIMELINE.finaleStart) / 1.6));
  return { cx: relief.cx + (whole.cx - relief.cx) * u, cy: relief.cy + (whole.cy - relief.cy) * u, w: relief.w + (whole.w - relief.w) * u, ax: 0.5 };
}

// Where to jump for "건너뛰기": the next scene boundary.
export function nextSceneTime(t: number): number {
  return [TIMELINE.act1End, TIMELINE.transitionEnd, TIMELINE.finaleStart, TIMELINE.end].find((boundary) => boundary > t + 0.05) ?? TIMELINE.end;
}
