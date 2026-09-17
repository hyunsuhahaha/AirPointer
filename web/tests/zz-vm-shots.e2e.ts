import { expect, test } from "@playwright/test";
const SP = "C:/Users/hyuns/AppData/Local/Temp/claude/C--Users-hyuns-OneDrive----ChatGPT-aigongmo/1475e7ea-6833-4900-aae3-6df3f4b190d4/scratchpad";
test.use({ channel: "chrome", viewport: { width: 1440, height: 900 } });
test("vm shots", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:3000");
  await page.getByRole("button", { name: "실제 활용 예시" }).click();
  await page.getByRole("button", { name: /02\s*VM 설정/ }).click();
  const started = Date.now();
  for (const s of [1.6, 5.5, 8.95, 11.1, 16.5, 20.8, 22.5, 24.8, 27.4, 29.5, 33.5]) {
    const wait = (s / 1.25) * 1000 - (Date.now() - started);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.screenshot({ path: `${SP}/vm-${String(s).replace(".", "_")}.png` });
  }
  await expect(page.getByRole("button", { name: /다시 보기/ })).toBeVisible({ timeout: 5000 });
  console.log("errors", JSON.stringify(errors));
});
