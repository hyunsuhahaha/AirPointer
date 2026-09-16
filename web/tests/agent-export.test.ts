import assert from "node:assert/strict";
import test from "node:test";
import { exportAgentContext } from "../src/lib/browser-agent-export.ts";
import type { BrowserReplayBuffer, ReplayCapsule } from "../src/lib/replay-buffer.ts";

const tinyImage = "data:image/jpeg;base64,AAEC";
const capsule: ReplayCapsule = {
  startedAt: 1_000, triggeredAt: 16_000,
  overviewFrames: Array.from({ length: 12 }, (_, index) => ({ url: tinyImage, capturedAt: 1_000 + index * 1_000, atSeconds: 15 - index })),
  segments: [{ blob: new Blob(["webm"], { type: "video/webm" }), startedAt: 1_000, durationMs: 15_000 }],
};
const buffer = {
  recentCapsule: async (_seconds: number, count: number) => { assert.equal(count, 12); return capsule; },
  exportMetadata: () => ({ captures: [{ dataUrl: tinyImage, capturedAt: 1_250 }], events: [{ startedAt: 3_000, peakAt: 3_250, endedAt: 3_500, peakScore: 0.4, bbox: [0.1, 0.2, 0.3, 0.4] as [number, number, number, number], extent: 0.02 }] }),
} as unknown as BrowserReplayBuffer;

test("파일 첨부 내보내기는 ZIP 없이 문서와 이미지 12개를 개별 파일로 만든다", async () => {
  const result = await exportAgentContext(buffer, "attach", 15, "monitor");
  assert.equal(result.files?.length, 13);
  assert.match(result.files![0].name, /^Export-.*-context\.md$/);
  assert.match(await result.files![0].text(), /기록 구간:/);
  assert.doesNotMatch(await result.files![0].text(), /자료 출처|사용자가 허용한|공유 범위/);
  assert.doesNotMatch(await result.files![0].text(), /실제 클릭|추론이라고/);
  assert.equal(result.files?.filter((file) => file.name.endsWith(".jpg")).length, 12);
  assert.match(result.prompt, /첨부한 Export-.*-context\.md와 화면 이미지 12장/);
  assert.doesNotMatch(result.prompt, /클릭·키 입력|추론이라고/);
});

test("Agent Link와 Local Folder는 문서·메타데이터·화면·녹화를 모두 만든다", async () => {
  const result = await exportAgentContext(buffer, "complete", 15, "monitor");
  for (const name of ["context.md", "events.json", "captures/", "captures/preview/", "recording/"]) assert.ok(result.files.some((file) => file.name.includes(name)), name);
  const events = JSON.parse(await result.files.find((file) => file.name === "events.json")!.text());
  assert.equal(events.source, "visual_change");
  assert.equal(events.events[0].peakAt, 3_250);
  assert.equal(result.files.filter((file) => file.name.endsWith(".webm")).length, 1);
});

test("대표 화면은 WebM 디코딩 결과보다 실제 주기 프리뷰를 우선한다", async () => {
  const previewImage = "data:image/jpeg;base64,cHJldmlldw==";
  const previewBuffer = {
    recentCapsule: async () => capsule,
    exportMetadata: () => ({
      captures: Array.from({ length: 6 }, (_, index) => ({ dataUrl: previewImage, capturedAt: 2_000 + index * 1_000 })),
      events: [],
    }),
  } as unknown as BrowserReplayBuffer;
  const result = await exportAgentContext(previewBuffer, "complete", 15, "monitor");
  const representative = result.files.find((file) => /^captures\/[^/]+\.jpg$/.test(file.name));
  assert.ok(representative);
  assert.equal(await representative.text(), "preview");
});
