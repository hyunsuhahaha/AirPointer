import { test } from "node:test";
import assert from "node:assert/strict";
import { InteractiveReplay } from "../src/lib/interactive-replay.ts";

test("interactive replay returns the state actually visible at a requested time", () => {
  const replay = new InteractiveReplay([
    { at: 1000, url: "order-A" }, { at: 2500, url: "order-B-quantity-2" },
    { at: 4000, url: "card-processing" }, { at: 5400, url: "auth-error" },
    { at: 6050, url: "pending" },
  ], 7000, 1200, 760);
  assert.equal(replay.atOffsets([-1.4])[0].url, "auth-error");
  assert.equal(replay.atOffsets([-.8])[0].url, "pending");
  assert.equal(replay.atOffsets([-4])[0].url, "order-B-quantity-2");
  assert.equal(replay.atOffsets([-8]).length, 0);
  assert.equal(replay.seconds, 6);
  assert.equal(replay.overview().length, 6);
  assert.ok(replay.overview().every(f => f.atSeconds <= 6));
});

test("a state remains available when it spans the retention boundary", () => {
  const replay = new InteractiveReplay([{ at: 1000, url: "still-visible" }], 90000, 1200, 760);
  assert.equal(replay.seconds, 60);
  assert.equal(replay.atOffsets([-60])[0].url, "still-visible");
  assert.equal(replay.atOffsets([0])[0].url, "still-visible");
});
