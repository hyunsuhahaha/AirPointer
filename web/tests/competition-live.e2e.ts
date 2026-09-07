import { expect, test } from "@playwright/test";
test.use({ channel: "chrome" });
for (const method of ["card", "bank"]) test(`live model analyzes the actual ${method} interaction`, async ({ page }) => {
  test.skip(process.env.AIRPOINTER_LIVE_ANALYSIS !== "1", "Explicit live API verification only");
  test.setTimeout(180_000);
  const responses: { status: number; frames: number; incident: boolean }[] = [];
  page.on("response", async response => {
    if (response.url().endsWith("/api/analyze")) {
      const data = await response.json().catch(() => ({}));
      responses.push({ status: response.status(), frames: response.request().postDataJSON().frames.length, incident: Boolean(data.incident) });
    }
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(process.env.AIRPOINTER_E2E_URL || "http://localhost:3000");
  await page.getByRole("button", { name: "30초 체험하기" }).click();
  if (method === "bank") await page.getByRole("button", { name: "계좌 결제", exact: true }).click();
  await page.getByRole("button", { name: "결제 요청", exact: true }).click();
  await page.getByRole("button", { name: "방금 알림 찾아줘" }).click({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "보고서 다운로드" })).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole("heading", { name: "확인된 사실" })).toBeVisible();
  await expect(page.getByRole("button", { name: /되감기/ }).first()).toBeVisible();
  await expect(page.getByLabel("시간 되감기 뷰어")).toHaveAttribute("data-phase", "revealed", { timeout: 10_000 });
  await page.screenshot({ path: `test-results/competition-live-${method}.png`, fullPage: true });
  const result = await page.getByLabel("리플레이 사건 작업대").innerText();
  expect(result).toMatch(method === "bank" ? /정상|승인|완료/ : /인증|AUTH_TIMEOUT|초과/);
  console.log(JSON.stringify({ liveResponses: responses, result: await page.getByLabel("리플레이 사건 작업대").innerText() }));
});
