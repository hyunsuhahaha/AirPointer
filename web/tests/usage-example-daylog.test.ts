import assert from "node:assert/strict";
import test from "node:test";
import { dayMarkdown, dayStart, segmentsOf } from "../src/lib/day-log.ts";
import { BEATS, CAPTIONS, DURATION, clockAt, dayAt, heldAt, mdAt, selectedAt, statusAt } from "../src/lib/usage-example-daylog.ts";

const DATE = "2026-09-17";
const START = dayStart(DATE);
const labels = (t: number) => segmentsOf(dayAt(t, DATE, START)).map((segment) => segment.label);

test("처음엔 장면만 모이고, 기록 간격마다 한 줄이 생긴다", () => {
  assert.deepEqual(labels(BEATS.settles[0] - 0.01), []);
  assert.equal(heldAt(0.95), 4);
  assert.equal(statusAt(1.2, START).state, "working");
  assert.match(statusAt(1.2, START).message, /09:15–09:30 장면 4개 정리 중/);
  assert.deepEqual(labels(BEATS.settles[0]), ["A프로젝트 결제 화면 수정"]);
});

test("같은 일은 한 줄로 합쳐지고 중간에 한 일이 쌓인다", () => {
  const [first] = segmentsOf(dayAt(BEATS.settles[1], DATE, START));
  assert.equal(first.endedAt - first.startedAt, 30 * 60_000);
  assert.deepEqual(first.side.map((item) => item.label), ["카톡 업무 연락", "뉴스 보기", "Slack 확인"]);
  assert.deepEqual(labels(BEATS.settles[2]), ["A프로젝트 결제 화면 수정", "유튜브 시청 · React 19 강의"]);
});

test("오후는 빨리 감기고, 끝에는 하루가 채워진다", () => {
  assert.equal(clockAt(0), 555);
  assert.equal(clockAt(DURATION), 1050);
  const day = dayAt(DURATION, DATE, START);
  assert.equal(segmentsOf(day).length, 6);
  assert.equal(day.sessions.length, 2);
  assert.equal(day.bookmarks.length, 1);
});

test("한 줄을 열어 보여준 뒤 MD 문서를 띄운다", () => {
  assert.equal(selectedAt(BEATS.select - 0.01, START), null);
  const selected = selectedAt(BEATS.select, START);
  assert.ok(segmentsOf(dayAt(BEATS.select, DATE, START)).some((segment) => segment.startedAt === selected));
  assert.equal(mdAt(BEATS.md[0] - 0.01).visible, false);
  assert.equal(mdAt(BEATS.md[1]).progress, 1);
  assert.match(dayMarkdown(dayAt(DURATION, DATE, START), () => null), /- \*\*09:15–09:45\*\* A프로젝트 결제 화면 수정\n {2}- 중간에: 카톡 업무 연락 3분/);
});

test("자막은 재생 시간 안에 있고 겹치지 않는다", () => {
  CAPTIONS.forEach((caption, index) => {
    assert.ok(caption.start < caption.end && caption.end <= DURATION);
    if (index > 0) assert.ok(caption.start >= CAPTIONS[index - 1].end);
  });
});
