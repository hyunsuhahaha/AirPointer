import { test, expect } from "@playwright/test";

test.use({ channel: "chrome", reducedMotion: "reduce" });

test("모바일 키보드로 시나리오를 고르면 영상과 분석이 자동 진행된다", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/api/analyze", async route => {
    const body = route.request().postDataJSON();
    if (body.exploration.round === 0) return route.fulfill({ json: { explorationRequests: [{ type: "frames", offsetsSeconds: [-4] }] } });
    return route.fulfill({ json: {
      analysis: "avatar_url 컬럼을 조회하지만 002_add_avatar.sql 마이그레이션이 적용되지 않았습니다.",
      evidence: [{ frameIndex: body.frames.length - 1, claim: "SQLite가 avatar_url 컬럼이 없다고 보고합니다." }],
      incident: { title: "미적용 DB 마이그레이션", facts: ["no such column: avatar_url"], possibleCause: "마이그레이션 미적용", nextChecks: ["002_add_avatar.sql을 적용하세요."] },
    } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(process.env.AIRPOINTER_E2E_URL || "http://localhost:3000");
  await page.getByRole("button", { name: "30초 체험하기" }).click();
  const scenario = page.getByRole("button", { name: /DB 마이그레이션/ });
  await scenario.focus(); await page.keyboard.press("Enter");
  const video = page.getByLabel(/실제 개발환경 녹화/);
  await expect(video).toBeVisible();
  await video.evaluate((element: HTMLVideoElement) => { element.playbackRate = 8; });
  await expect(page.getByRole("heading", { name: "미적용 DB 마이그레이션" })).toBeVisible({ timeout: 60_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "새 체험", exact: true }).click();
  await expect(page.getByRole("button", { name: "30초 체험하기" })).toBeVisible();
});
