import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ channel: "chrome" });
const url = process.env.AIRPOINTER_E2E_URL || "http://localhost:3000";

test("30초 체험은 실제 개발 녹화를 자동 재생하고 PiP에서 탐색 과정을 보여준다", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const testWindow = window as unknown as { demoPipRequests: number; realDemoPlay: typeof HTMLMediaElement.prototype.play };
    testWindow.demoPipRequests = 0;
    testWindow.realDemoPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = async function () { /* deterministic replay timing in this test */ };
    const pictureInPicture = { window: null as Window | null, requestWindow: async () => {
      (window as unknown as { demoPipRequests: number }).demoPipRequests++;
      throw new Error("테스트 환경에서는 OS PiP를 표시하지 않음");
    } };
    Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: pictureInPicture });
  });
  let requests = 0;
  let transmittedEvidence = "";
  await page.route("**/api/analyze", async route => {
    requests++;
    const body = route.request().postDataJSON();
    if (body.exploration.round === 0) return route.fulfill({ json: { explorationRequests: [{ type: "frames", offsetsSeconds: [-4] }] } });
    transmittedEvidence = body.frames.at(-1);
    return route.fulfill({ json: {
      analysis: "편집한 checkout-redesign과 서버가 실행 중인 checkout-main이 서로 다른 worktree입니다.",
      evidence: [{ frameIndex: body.frames.length - 1, claim: "편집 경로와 서버 root가 다릅니다." }],
      incident: { title: "서로 다른 Worktree", facts: ["편집 경로와 서버 경로가 다름"], possibleCause: "다른 체크아웃에서 개발 서버를 실행함", nextChecks: ["서버를 편집 중인 worktree에서 다시 시작하세요."] },
      captureContext: "실제 Node 서버 실행 녹화",
    } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  await page.getByRole("button", { name: "30초 체험하기" }).click();
  await expect(page.getByText("실제 실행으로 만든 개발 시나리오")).toBeVisible();
  await page.screenshot({ path: ".impeccable/review/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /Worktree 혼선/ }).click();
  const video = page.getByLabel(/실제 개발환경 녹화/);
  await expect(video).toBeVisible();
  await expect(video).not.toHaveAttribute("controls", "");
  await video.evaluate((element: HTMLVideoElement) => { element.pause(); element.currentTime = 1; });
  await expect.poll(() => page.evaluate(() => Boolean(window.documentPictureInPicture?.window))).toBe(false);
  await expect.poll(() => page.evaluate(() => (window as unknown as { demoPipRequests: number }).demoPipRequests)).toBe(0);
  await expect(page.getByLabel("체험 PiP")).toHaveCount(0);
  await expect(page.getByText("아직 AI에 질문하거나 화면을 보내지 않았습니다.")).toBeVisible();
  await expect(page.getByLabel("샘플 리플레이에 질문")).toHaveCount(0);
  await expect(page.getByText("방금 사라진 오류, 다시 재현하지 마세요.")).toBeHidden();
  await page.screenshot({ path: ".impeccable/review/before-error.png", fullPage: true });

  await video.evaluate((element: HTMLVideoElement) => { element.currentTime = 3.2; });
  await expect.poll(() => page.evaluate(() => (window as unknown as { demoPipRequests: number }).demoPipRequests)).toBe(1);
  await expect(page.getByLabel("체험 PiP")).toBeVisible();
  await expect(page.getByLabel("샘플 리플레이에 질문")).toBeVisible();
  await expect(page.getByLabel("체험 PiP").getByRole("log").getByText("코드를 고쳤는데 왜 미리보기에는 반영되지 않았어? 화면에 나온 경로를 근거로 알려줘.")).toBeVisible();
  await expect(page.getByLabel("체험 PiP").getByRole("textbox", { name: "AI에게 질문" })).toHaveValue("");
  expect(requests).toBe(0);
  await page.screenshot({ path: ".impeccable/review/pip-after-error.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("체험 PiP")).toBeInViewport();
  await page.screenshot({ path: ".impeccable/review/pip-after-error-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await video.evaluate((element: HTMLVideoElement) => {
    HTMLMediaElement.prototype.play = (window as unknown as { realDemoPlay: typeof HTMLMediaElement.prototype.play }).realDemoPlay;
    element.playbackRate = 8; void element.play();
  });
  await expect(page.getByRole("heading", { name: "서로 다른 Worktree" })).toBeVisible({ timeout: 60_000 });
  expect(requests).toBe(2);
  const pipText = await page.getByLabel("체험 PiP").innerText();
  expect(pipText).toContain("checkout-redesign");
  expect(pipText).toContain("탐색 완료");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "보고서 다운로드" }).click();
  const download = await downloadPromise;
  const html = await readFile((await download.path())!, "utf8");
  expect(html).toContain("서로 다른 Worktree");
  expect(html).toContain(transmittedEvidence);
  expect(html).not.toContain("<script");

  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
