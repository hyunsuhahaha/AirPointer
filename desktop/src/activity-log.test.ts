import assert from "node:assert/strict";
import test from "node:test";
import { ActivityLog, KEEP_MS, ignoredPath } from "./activity-log";
import { safeContextPath } from "./settings";

test("창이 바뀔 때만 기록하고, 구간 시작 때 앞에 있던 창도 함께 준다", () => {
  const log = new ActivityLog();
  assert.equal(log.recordWindow({ at: 1_000, app: "Code", title: "Hero.tsx" }), true);
  assert.equal(log.recordWindow({ at: 1_500, app: "Code", title: "Hero.tsx" }), false);
  log.recordWindow({ at: 5_000, app: "chrome", title: "localhost:3000" });
  log.recordWindow({ at: 9_000, app: "Code", title: "Hero.module.css" });
  const slice = log.slice(4_000, 8_000);
  assert.deepEqual(slice.windows.map((entry) => entry.title), ["Hero.tsx", "localhost:3000"]);
});

test("같은 파일이 1초 안에 여러 번 저장되면 한 번으로 친다", () => {
  const log = new ActivityLog();
  log.recordFileSave({ at: 1_000, path: "src/a.css" });
  log.recordFileSave({ at: 1_300, path: "src/a.css" });
  log.recordFileSave({ at: 5_000, path: "src/a.css" });
  assert.deepEqual(log.slice(0, 10_000).fileSaves, [{ at: 1_300, path: "src/a.css" }, { at: 5_000, path: "src/a.css" }]);
});

test("오래된 기록은 지우되, 그때 앞에 있던 창 하나는 남긴다", () => {
  const log = new ActivityLog();
  log.recordWindow({ at: 0, app: "a", title: "old" });
  log.recordWindow({ at: 10, app: "b", title: "still front" });
  log.recordWindow({ at: KEEP_MS + 100, app: "c", title: "new" });
  assert.deepEqual(log.slice(KEEP_MS, KEEP_MS + 200).windows.map((entry) => entry.title), ["still front", "new"]);
});

test("빌드 산출물과 의존성 폴더의 변경은 무시한다", () => {
  for (const file of ["node_modules/x/index.js", ".git/index", "web/.next/cache/a", "src/a.ts~"]) assert.equal(ignoredPath(file), true, file);
  assert.equal(ignoredPath("src/components/Hero.module.css"), false);
});

test("내보내기 파일은 새 폴더 밖으로 나갈 수 없다", () => {
  const root = process.platform === "win32" ? "C:\\exports" : "/exports";
  assert.ok(safeContextPath(root, "Context-2026", "captures/01.jpg").target.includes("Context-2026"));
  for (const bad of ["../evil.txt", "..\\evil.txt", "/etc/passwd", ""]) assert.throws(() => safeContextPath(root, "Context-2026", bad), bad);
  assert.throws(() => safeContextPath(root, "..", "a.txt"));
  assert.throws(() => safeContextPath(root, "a/b", "a.txt"));
});
