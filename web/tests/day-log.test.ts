import assert from "node:assert/strict";
import test from "node:test";
import {
  addBookmark, addRecord, categoryTotals, dayMarkdown, dayStart, emptyDay, expiredDates, isActivityRequest, normalizeDay,
  pickEvenly, recordedMs, removeRange, renameSegment, segmentsOf, touchSession,
} from "../src/lib/day-log.ts";
import type { ActivityCategory, DayLog, DaySide } from "../src/lib/day-log.ts";

const DATE = "2026-09-17";
const at = (hour: number, minute: number) => dayStart(DATE) + (hour * 60 + minute) * 60_000;
const record = (day: DayLog, from: [number, number], to: [number, number], category: ActivityCategory, label: string, side: DaySide[] = [], thumbId: string | null = null) =>
  addRecord(day, { startedAt: at(...from), endedAt: at(...to), category, label, app: category === "dev" ? "VS Code" : "", side, thumbId });

// 15-minute records: dev with interruptions, then video, then docs.
function sampleDay() {
  let day = emptyDay(DATE);
  day = touchSession(day, at(9, 15), at(9, 30), "monitor");
  day = touchSession(day, at(9, 15), at(12, 0), "monitor");
  day = record(day, [9, 15], [9, 30], "dev", "A프로젝트 프론트엔드 수정", [{ label: "카카오톡 업무 연락", minutes: 3 }], "r1");
  day = record(day, [9, 30], [9, 45], "dev", "A프로젝트  프론트엔드 수정", [{ label: "뉴스 보기", minutes: 2 }, { label: "카카오톡 업무 연락", minutes: 2 }], "r2");
  day = record(day, [9, 45], [10, 30], "dev", "A프로젝트 프론트엔드 수정", [], "r3");
  day = record(day, [10, 30], [11, 30], "video", "유튜브 시청", [], "r4");
  day = record(day, [11, 30], [12, 0], "docs", "분기 보고서 작성");
  day = addBookmark(day, { id: "b1", at: at(10, 40), note: "볼 영상", thumbId: "b1-shot" });
  return day;
}

test("주로 한 일이 같은 구간은 합쳐지고, 중간에 한 일은 시간이 더해진다", () => {
  const segments = segmentsOf(sampleDay());
  assert.deepEqual(segments.map((segment) => [segment.startedAt, segment.endedAt, segment.label]), [
    [at(9, 15), at(10, 30), "A프로젝트 프론트엔드 수정"],
    [at(10, 30), at(11, 30), "유튜브 시청"],
    [at(11, 30), at(12, 0), "분기 보고서 작성"],
  ]);
  assert.deepEqual(segments[0].side, [{ label: "카카오톡 업무 연락", minutes: 5 }, { label: "뉴스 보기", minutes: 2 }]);
  assert.deepEqual(segments[0].thumbIds, ["r1", "r2", "r3"]);
  assert.deepEqual(segments[1].bookmarks.map((bookmark) => bookmark.note), ["볼 영상"]);
});

test("사이에 빈 시간이 있으면 같은 일이어도 따로 보인다", () => {
  let day = emptyDay(DATE);
  day = record(day, [9, 0], [9, 15], "dev", "코드 수정");
  day = record(day, [13, 0], [13, 15], "dev", "코드 수정");
  assert.equal(segmentsOf(day).length, 2);
});

test("분류별 시간은 긴 순서로 모이고, 기록 시간은 공유한 시간이다", () => {
  const day = sampleDay();
  assert.deepEqual(categoryTotals(segmentsOf(day)).map((total) => [total.category, total.ms / 60_000]), [["dev", 75], ["video", 60], ["docs", 30]]);
  assert.equal(recordedMs(day), 165 * 60_000);
});

test("활동 이름을 고치면 합쳐진 구간 전체가 바뀐다", () => {
  const day = sampleDay();
  const renamed = renameSegment(day, segmentsOf(day)[0], "whatwas 타임라인 개발");
  assert.deepEqual(segmentsOf(renamed).map((segment) => segment.label), ["whatwas 타임라인 개발", "유튜브 시청", "분기 보고서 작성"]);
});

test("구간을 지우면 기록·북마크·썸네일이 빠지고 세션이 잘린다", () => {
  const { day, removedThumbs } = removeRange(sampleDay(), at(10, 30), at(11, 30));
  assert.deepEqual(removedThumbs, ["r4", "b1-shot"]);
  assert.deepEqual(day.sessions.map((session) => [session.startedAt, session.endedAt]), [[at(9, 15), at(10, 30)], [at(11, 30), at(12, 0)]]);
  assert.deepEqual(segmentsOf(day).map((segment) => segment.label), ["A프로젝트 프론트엔드 수정", "분기 보고서 작성"]);
});

test("장면은 처음과 끝을 포함해 고르게 고른다", () => {
  assert.deepEqual(pickEvenly([1, 2, 3], 8), [1, 2, 3]);
  assert.deepEqual(pickEvenly([...Array(15).keys()], 8), [0, 2, 4, 6, 8, 10, 12, 14]);
});

test("예전 형식 기록도 읽고, 보관 기간이 지난 날짜만 고른다", () => {
  assert.deepEqual(normalizeDay({ date: DATE }), emptyDay(DATE));
  assert.deepEqual(expiredDates(["2026-09-17", "2026-09-11", "2026-09-10", "2026-08-01"], DATE, 7), ["2026-09-10", "2026-08-01"]);
});

test("정리 요청은 JPEG 장면 1~8장과 구간 길이만 받는다", () => {
  const frame = { time: "09:15", image: "data:image/jpeg;base64,AAAA" };
  assert.ok(isActivityRequest({ frames: [frame], minutes: 15, previous: [] }));
  assert.ok(!isActivityRequest({ frames: [], minutes: 15, previous: [] }));
  assert.ok(!isActivityRequest({ frames: Array(9).fill(frame), minutes: 15, previous: [] }));
  assert.ok(!isActivityRequest({ frames: [{ ...frame, image: "data:image/png;base64,AAAA" }], minutes: 15, previous: [] }));
  assert.ok(!isActivityRequest({ frames: [frame], minutes: 0, previous: [] }));
});

test("MD 문서는 '시각 주로 한 일 + 중간에 한 일'부터 보여준다", () => {
  const markdown = dayMarkdown(sampleDay(), (id) => id === "r1" ? "thumbs/0915.jpg" : null);
  assert.match(markdown, /^# 2026-09-17 \(목\) 작업 타임라인/);
  assert.match(markdown, /활동 2시간 45분 · 3개 활동 · 북마크 1개/);
  assert.match(markdown, /- \*\*09:15–10:30\*\* A프로젝트 프론트엔드 수정\n {2}- 중간에: 카카오톡 업무 연락 5분 · 뉴스 보기 2분\n- \*\*10:30–11:30\*\* 유튜브 시청/);
  assert.match(markdown, /\| 개발 \| 1시간 15분 \| 45% \|/);
  assert.match(markdown, /\| 09:15–10:30 \| 1시간 15분 \| A프로젝트 프론트엔드 수정 \| 개발 \| VS Code \| 카카오톡 업무 연락 5분 · 뉴스 보기 2분 \|/);
  assert.match(markdown, /!\[09:15 A프로젝트 프론트엔드 수정\]\(thumbs\/0915\.jpg\)/);
  assert.match(markdown, /- \*\*10:40\*\* 볼 영상/);
});
