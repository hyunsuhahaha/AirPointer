import { expect, test } from "@playwright/test";

test.use({ channel: "chrome" });
const cases = [
  { button: /Worktree 혼선/, expected: /worktree|체크아웃|경로|checkout-main/i, alternate: "서버를 다시 켜도 수정이 안 보이는 이유를 화면 경로만으로 설명해줘." },
  { button: /DB 마이그레이션/, expected: /migration|마이그레이션|avatar_url|column/i, alternate: "이 오류가 코드 오타인지 DB 상태 문제인지 화면 근거로 구분해줘." },
  { button: /테스트 회귀/, expected: /parseInt|소수점|12\.99|정수/i, alternate: "12.99가 12가 되는 정확한 코드와 최소 수정 방향을 찾아줘." },
];

for (const scenario of cases) test(`실제 녹화 분석: ${scenario.button.source}`, async ({ page }) => {
  test.skip(process.env.AIRPOINTER_LIVE_ANALYSIS !== "1", "실제 모델 검증을 명시적으로 실행할 때만 사용");
  test.setTimeout(180_000);
  await page.goto(process.env.AIRPOINTER_E2E_URL || "http://localhost:3000");
  await page.getByRole("button", { name: "30초 체험하기" }).click();
  await page.getByRole("button", { name: scenario.button }).click();
  const video = page.getByLabel(/실제 개발환경 녹화/);
  await video.evaluate((element: HTMLVideoElement) => { element.playbackRate = 8; });
  await expect(page.getByRole("button", { name: "보고서 다운로드" })).toBeVisible({ timeout: 150_000 });
  const result = await page.getByLabel("리플레이 사건 작업대").innerText();
  expect(result).toMatch(scenario.expected);
  await page.getByRole("button", { name: "질문 바꿔 재분석" }).click();
  await page.getByLabel("샘플 리플레이에 질문").fill(scenario.alternate);
  const alternateRequest = page.waitForRequest(request => request.url().endsWith("/api/analyze") && request.postDataJSON().question === scenario.alternate);
  await page.getByRole("button", { name: "같은 기록 다시 분석" }).click();
  await expect(page.getByRole("button", { name: "보고서 다운로드" })).toBeHidden();
  await alternateRequest;
  await expect(page.getByRole("button", { name: "보고서 다운로드" })).toBeVisible({ timeout: 150_000 });
  const alternateResult = await page.getByLabel("리플레이 사건 작업대").innerText();
  expect(alternateResult).toMatch(scenario.expected);
  console.log(JSON.stringify({ scenario: scenario.button.source, result, alternateResult }));
});
