import { test, expect } from "@playwright/test";
test.use({ channel: "chrome", reducedMotion: "reduce" });

test("mobile keyboard interaction and reduced-motion evidence remain usable", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/analyze", route => route.fulfill({ json: {
    analysis: "샘플 요청이 처리됐습니다.", evidence: [{ frameIndex: 0, claim: "직접 선택한 주문 화면" }],
    incident: { title: "샘플 주문 확인", facts: ["선택된 주문"], possibleCause: "원인 추정 없음", nextChecks: [] },
  } }));
  await page.goto(process.env.AIRPOINTER_E2E_URL || "http://localhost:3000");
  await page.getByRole("button", { name: "30초 체험하기" }).click();
  const order = page.getByRole("button", { name: "주문 10430 박서연 선택" });
  await order.focus(); await page.keyboard.press("Enter");
  await expect(order).toHaveAttribute("aria-pressed", "true");
  const bank = page.getByRole("button", { name: "계좌 결제", exact: true });
  await bank.focus(); await page.keyboard.press("Space");
  await expect(bank).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "test-results/interactive-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "결제 요청", exact: true }).click();
  await page.getByRole("button", { name: "방금 알림 찾아줘" }).click();
  await expect(page.getByLabel("시간 되감기 뷰어")).toHaveAttribute("data-phase", "revealed", { timeout: 60_000 });
  await expect(page.getByText("↶ REWIND", { exact: true })).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "새 체험", exact: true }).click();
  await expect(page.getByRole("button", { name: "30초 체험하기" })).toBeVisible();
});
