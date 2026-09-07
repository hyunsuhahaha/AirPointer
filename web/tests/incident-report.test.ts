import { test } from "node:test";
import assert from "node:assert/strict";
import { reportHtml } from "../src/lib/incident-report.ts";

test("download escapes model text and excludes executable or remote image sources", () => {
  const html = reportHtml({ answer: '<script>alert("bad")</script>', context: "<img src=x onerror=alert(1)>", sample: true, evidence: [
    { claim: "<svg onload=alert(1)>", seconds: 6, image: "https://example.com/private.png" },
    { claim: "safe", seconds: 1, image: "data:image/png;base64,AAAA" },
  ] });
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("https://example.com"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes('src="data:image/png;base64,AAAA"'));
  assert.ok(html.includes("샘플 시나리오"));
});
