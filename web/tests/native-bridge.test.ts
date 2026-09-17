import assert from "node:assert/strict";
import test from "node:test";
import { activityMarkdown, nativeFolderPrompt, shortcutLabel } from "../src/lib/native-bridge.ts";

test("작업 기록 문서는 구간 시작 전부터 앞에 있던 창을 구간 시작 시각으로 적는다", () => {
  const since = Date.parse("2026-09-17T05:00:00Z");
  const text = activityMarkdown({
    windows: [{ at: since - 60_000, app: "Code", title: "Hero.tsx" }, { at: since + 5_000, app: "", title: "" }],
    fileSaves: [{ at: since + 3_000, path: "src/Hero.module.css" }],
  }, since);
  assert.match(text, /2026-09-17T05:00:00.000Z · Code — Hero\.tsx/);
  assert.match(text, /알 수 없는 프로그램 — \(제목 없음\)/);
  assert.match(text, /2026-09-17T05:00:03.000Z · src\/Hero\.module\.css/);
});

test("기록이 없으면 비어 있다고 적고, 작업 폴더 지정을 안내한다", () => {
  const text = activityMarkdown({ windows: [], fileSaves: [] }, 0);
  assert.match(text, /### 앞에 있던 창\n\n- 기록 없음/);
  assert.match(text, /작업 폴더를 지정하면 기록됩니다/);
});

test("프롬프트는 앱이 저장한 폴더의 전체 경로를 알려준다", () => {
  assert.match(nativeFolderPrompt("C:\\Users\\me\\Documents\\방금그거뭐였지\\Context-1"), /"C:\\Users\\me\\Documents\\방금그거뭐였지\\Context-1" 폴더/);
  assert.equal(shortcutLabel("CommandOrControl+Shift+E"), "Ctrl + Shift + E");
});
