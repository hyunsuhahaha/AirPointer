import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ channel: "chrome", acceptDownloads: true });
const url = process.env.AIRPOINTER_E2E_URL || "http://localhost:3000";

test("공모전 체험은 Manual PDF와 Agent Link를 제공한다", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: {
      window: null, requestWindow: async () => { throw new Error("테스트 환경에서는 OS PiP를 표시하지 않음"); },
    } });
  });
  let apiCalls = 0;
  await page.route("**/api/analyze", (route) => { apiCalls++; return route.abort(); });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: url });
  await page.goto(url);
  await page.getByRole("button", { name: "30초 체험하기" }).click();
  await page.getByRole("button", { name: /Worktree 혼선/ }).click();
  const video = page.getByLabel(/실제 개발환경 녹화/);
  await expect(video).toBeVisible();
  await video.evaluate(async (element: HTMLVideoElement) => { element.playbackRate = 8; await element.play(); });
  const pip = page.getByLabel("체험 PiP");
  await expect(pip.getByRole("button", { name: "AI Context 생성" })).toBeEnabled({ timeout: 40_000 });
  await pip.getByRole("combobox", { name: "전송 구간" }).selectOption("5");
  await pip.getByRole("button", { name: /Manual/ }).click();
  await pip.getByRole("combobox", { name: "첨부 형식" }).selectOption("pdf");
  const filenames: string[] = [];
  page.on("download", (download) => filenames.push(download.suggestedFilename()));
  const pdfDownload = page.waitForEvent("download");
  await pip.getByRole("button", { name: "AI Context 생성" }).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toMatch(/^Export-.*\.pdf$/);
  const pdfBytes = await readFile((await pdf.path())!);
  expect(pdfBytes.subarray(0, 8).toString()).toBe("%PDF-1.4");
  expect(pdfBytes.toString("latin1").match(/\/Type \/Page\b/g)?.length).toBeGreaterThanOrEqual(7);
  const downloadsBefore = filenames.length;
  await pip.getByRole("button", { name: /Agent Link/ }).click();
  await pip.getByRole("button", { name: "AI Context 생성" }).click();
  await expect(pip.getByText(/이 프롬프트만 AI에/)).toBeVisible();
  expect(filenames.length).toBe(downloadsBefore);
  const prompt = await pip.locator("textarea[readonly]").inputValue();
  expect(prompt).toContain("최근 5초");
  expect(prompt).not.toMatch(/클릭·키 입력|추론이라고/);
  await pip.getByRole("button", { name: "프롬프트 복사" }).click();
  await expect(pip.getByRole("button", { name: "복사되었습니다" })).toBeVisible();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n")).toBe(prompt.replaceAll("\r\n", "\n"));
  const agentUrl = prompt.match(/https?:\/\/\S+\/context\/[A-Za-z0-9_-]+\/agent/)?.[0];
  expect(agentUrl).toBeTruthy();
  const agentResponse = await page.request.get(agentUrl!);
  expect(agentResponse.status()).toBe(200);
  const agentHtml = await agentResponse.text();
  expect(agentHtml).toContain("화면 맥락 기록");
  expect(agentHtml).toContain("화면 타임라인");
  expect(agentHtml).toContain("녹화");
  expect(agentHtml).not.toMatch(/자료 출처|사용자가 허용한|공유 범위/);
  expect(apiCalls).toBe(0);
});
