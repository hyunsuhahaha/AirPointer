import { expect, test } from "@playwright/test";

test.use({ channel: "chrome" });

test("하단 바로 로컬 버퍼의 지난 화면을 되감아 재생하고 LIVE로 돌아온다", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext("2d")!;
    const t0 = Date.now();
    setInterval(() => {
      const k = Math.floor((Date.now() - t0) / 1_000);
      context.fillStyle = `rgb(${(k * 10) % 256}, 40, 40)`; context.fillRect(0, 0, 640, 360);
    }, 50);
    navigator.mediaDevices.getDisplayMedia = async () => canvas.captureStream(15);
    Object.defineProperty(window, "documentPictureInPicture", { configurable: true, value: undefined });
  });
  await page.goto("http://localhost:3000");
  await page.getByRole("button", { name: "화면 공유 시작" }).first().click();
  await page.waitForTimeout(14_000);
  const slider = page.getByRole("slider", { name: "버퍼 재생 위치" });
  await expect(slider).toHaveAttribute("aria-valuetext", "실시간");

  // The fake screen encodes its elapsed second in the red channel, so a
  // sampled replay frame says which moment is on screen.
  const replayRed = () => page.evaluate(() => {
    const videos = [...document.querySelectorAll("video")].filter((video) => video.getAttribute("aria-hidden") === "true");
    const video = videos[0];
    const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 8;
    canvas.getContext("2d")!.drawImage(video, 0, 0, 8, 8);
    return { red: canvas.getContext("2d")!.getImageData(4, 4, 1, 1).data[0], t: video.currentTime, src: Boolean(video.src) };
  });

  // Keyboard: Home jumps to the oldest kept moment and starts playing.
  await slider.focus();
  await page.keyboard.press("Home");
  const bar = page.getByRole("group", { name: "지난 화면 재생" });
  await expect(bar).toBeVisible();
  await page.waitForTimeout(1_200);
  const early = await replayRed();
  expect(early.src).toBe(true);
  expect(Math.round(early.red / 10)).toBeLessThanOrEqual(3);

  // Pause, then step with arrows while paused.
  await bar.getByRole("button", { name: "일시정지" }).click();
  await expect(bar.getByRole("button", { name: "재생" })).toBeVisible();
  await slider.focus();
  for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150); }
  await page.waitForTimeout(800);
  const stepped = await replayRed();
  expect(Math.round(stepped.red / 10)).toBeGreaterThanOrEqual(3);

  // Drag: thumbnail while moving, video after release.
  const box = (await slider.boundingBox())!;
  const recordedWidth = await slider.evaluate((el) => (el.querySelector("[class*=bufferTrack] span") as HTMLElement).getBoundingClientRect().width);
  await page.mouse.move(box.x + recordedWidth * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + recordedWidth * 0.5, box.y + box.height / 2, { steps: 5 });
  await expect(page.locator("img[class*=replayPreview]")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator("img[class*=replayPreview]")).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(Math.round((await replayRed()).red / 10)).toBeGreaterThan(Math.round(stepped.red / 10));

  // Playing from 3s ago chains into the following segments (it stays that
  // far behind, like a live DVR) until LIVE is pressed.
  await page.keyboard.press("End");
  await expect(bar).toHaveCount(0);
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await expect(bar).toBeVisible();
  await page.waitForTimeout(1_000);
  const before = Number(await slider.getAttribute("aria-valuenow"));
  const redBefore = (await replayRed()).red;
  await page.waitForTimeout(4_000);
  const after = Number(await slider.getAttribute("aria-valuenow"));
  const redAfter = (await replayRed()).red;
  expect(after - before).toBeGreaterThanOrEqual(3);
  expect(redAfter).toBeGreaterThan(redBefore);
  await bar.getByRole("button", { name: /LIVE로 돌아가기/ }).click();
  await expect(bar).toHaveCount(0);
  await expect(slider).toHaveAttribute("aria-valuetext", "실시간");
  await slider.focus();

});
