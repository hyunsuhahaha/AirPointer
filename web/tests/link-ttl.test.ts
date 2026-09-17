import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LINK_TTL, LINK_TTL_OPTIONS, UNLIMITED, isExpired, linkTtlLabel, linkTtlMs, parseLinkTtl } from "../src/lib/link-ttl.ts";

test("링크 유지 시간은 고른 값만 쓰고, 그 외에는 기본 20분이다", () => {
  for (const option of LINK_TTL_OPTIONS) assert.equal(parseLinkTtl(option), option);
  assert.equal(parseLinkTtl("30"), 30);
  for (const bad of [undefined, null, 0, -5, 7, 999, "abc", "Unlimited"]) assert.equal(parseLinkTtl(bad), DEFAULT_LINK_TTL);
  assert.equal(linkTtlMs(5), 5 * 60_000);
  assert.equal(linkTtlMs(60), 60 * 60_000);
  assert.equal(linkTtlMs(undefined), 20 * 60_000);
});

test("무제한 링크는 만료 시각이 없고 절대 만료되지 않는다", () => {
  assert.equal(linkTtlMs(UNLIMITED), null);
  assert.equal(isExpired(null, Number.MAX_SAFE_INTEGER), false);
  assert.equal(isExpired(1_000, 1_000), true);
  assert.equal(isExpired(2_000, 1_000), false);
  assert.equal(linkTtlLabel(UNLIMITED), "삭제할 때까지");
  assert.equal(linkTtlLabel(60), "1시간");
});
