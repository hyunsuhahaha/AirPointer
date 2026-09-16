import { expect, test } from "@playwright/test";

test.use({ channel: "chrome", acceptDownloads: true });
const url = process.env.AIRPOINTER_E2E_URL || "http://localhost:3000";

test("공모전 체험은 선택 없이 시작해 Manual 화면 선택과 Agent Link를 제공한다", async ({ page }) => {
  test.setTimeout(120_000);
  // No OS PiP in tests: the demo falls back to its inline "체험 PiP" panel.
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
  await expect(pip).toBeVisible({ timeout: 40_000 });
  // The panel turns active once the recording has finished and is replayable.
  await expect(pip.getByText("화면 기록 중")).toBeVisible({ timeout: 40_000 });

  // Starts with no delivery mode, and nothing to export until one is picked.
  const modes = pip.getByRole("group", { name: "AI 내보내기 방식" });
  await expect(modes.locator('button[aria-pressed="true"]')).toHaveCount(0);
  await expect(pip.getByRole("button", { name: "AI Context 생성" })).toHaveCount(0);
  // The demo has no live share: no record start/stop, capture settings locked,
  // and the transport bar stays a plain progress bar rather than a scrubber.
  await expect(pip.getByRole("button", { name: /기록 시작|^중지$/ })).toHaveCount(0);
  await expect(pip.getByRole("combobox", { name: "캡처 간격" })).toBeDisabled();
  await expect(pip.getByRole("combobox", { name: "버퍼 길이" })).toBeDisabled();
  await expect(page.getByRole("slider", { name: "버퍼 재생 위치" })).toHaveCount(0);

  // Manual: representatives with distinct seconds, "…" only where there are
  // in-between frames, nothing selected, and a selected frame downloads.
  await modes.getByRole("button", { name: /Manual/ }).click();
  const picker = pip.getByRole("region", { name: "로컬 버퍼 화면 선택" });
  await expect(picker.getByText("선택 0장")).toBeVisible();
  const representatives = picker.locator('article[data-representative="true"]');
  await expect(representatives.first()).toBeVisible({ timeout: 30_000 });
  const labels = await picker.locator('[data-representative="true"] time').allTextContents();
  expect(labels.length).toBeGreaterThan(1);
  expect(new Set(labels).size).toBe(labels.length);
  await expect(picker.getByRole("button", { name: /^0개 사이 화면/ })).toHaveCount(0);
  await expect(picker.getByRole("button", { name: "선택한 0장 다운로드" })).toBeDisabled();
  await representatives.first().getByRole("button", { name: "선택", exact: true }).click();
  await expect(picker.getByText("선택 1장")).toBeVisible();
  const download = page.waitForEvent("download");
  await picker.getByRole("button", { name: "선택한 1장 다운로드" }).click();
  expect((await download).suggestedFilename()).toMatch(/^screen-.*\.(jpg|png)$/);

  // Agent Link: the prompt carries only the link, and the link serves the context.
  await modes.getByRole("button", { name: /Agent Link/ }).click();
  await pip.getByRole("combobox", { name: "전송 구간" }).selectOption("5");
  await pip.getByRole("button", { name: "AI Context 생성" }).click();
  await expect(pip.getByText(/이 프롬프트만 AI에/)).toBeVisible({ timeout: 30_000 });
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
  expect(agentHtml).toContain("context.md");
  // Agent Link shares the document, events and representative frames only;
  // raw WebM segments stay on the device.
  expect(agentHtml).not.toContain("녹화 조각");
  expect(agentHtml).not.toMatch(/자료 출처|사용자가 허용한|공유 범위/);

  // Nothing in the demo calls the analysis API.
  expect(apiCalls).toBe(0);
});
