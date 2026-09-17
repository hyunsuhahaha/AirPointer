import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

test.use({ channel: "chrome", viewport: { width: 1440, height: 900 } });
const url = process.env.AIRPOINTER_E2E_URL || "http://localhost:3000";

// The game canvas: the yellow hair and the stray yellow square are SVG fills.
const game = (page: Page) => page.locator("[class*=gameCanvas] svg").first();
const hasSquare = (page: Page) => game(page).locator('rect[fill="#ffe600"]').count().then((count) => count > 0);
const hasHair = (page: Page) => game(page).locator('path[fill="#ffd21f"]').count().then((count) => count > 0);
const yellowButtonGone = (page: Page) => page.locator('[class*=gameWindow] header i[data-gone="true"]').count().then((count) => count > 0);
const hasSun = (page: Page) => game(page).locator('circle[fill="#ffd43b"]').count().then((count) => count > 0);

test("실제 활용 예시 01: 원인을 좁혀 말해도 캡처만 요구하던 AI가, Agent Link로 저장 직후 화면을 보고 안 눌리는 버튼을 고친다", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(url);
  await page.getByRole("button", { name: "실제 활용 예시", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "실제 활용 예시" });
  // Nothing plays until a role is picked in the middle of the screen.
  const chooser = dialog.getByRole("region", { name: "직업 고르기" });
  await expect(chooser.getByRole("heading", { name: /당신이\s*\?\s*라면\?/ })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "브라우저" })).toHaveCount(0);
  await chooser.getByRole("button", { name: /웹 개발자/ }).hover();
  await expect(chooser.getByRole("heading", { name: /당신이\s*웹 개발자\s*라면\?/ })).toBeVisible();
  await chooser.getByRole("button", { name: /웹 개발자/ }).click();
  await expect(chooser).toHaveCount(0);
  await expect(dialog.getByRole("navigation", { name: "직업 선택" }).getByRole("button", { name: "웹 개발자" })).toHaveAttribute("aria-pressed", "true");
  const chat = dialog.getByRole("region", { name: "Claudy 대화" });
  const browser = dialog.getByRole("region", { name: "브라우저" });

  // 1. Saving shows a toast over the export button; the developer checks DevTools.
  await expect(browser.getByText("저장되었습니다")).toBeVisible({ timeout: 4_000 });
  await expect(browser.getByText(/기록된 요청 0건/)).toBeVisible({ timeout: 6_000 });

  // 2. A precise report, four screenshot requests, then "works on my machine".
  await expect(chat.getByText(/onClick 자체가 안 불리고/)).toBeVisible({ timeout: 6_000 });
  await expect(chat.getByText("에러 없다고 했잖아")).toBeVisible({ timeout: 8_000 });
  await expect(dialog.getByText("캡처 4장")).toBeVisible({ timeout: 8_000 });
  await expect(chat.getByText(/제 환경에서는 정상 작동합니다/)).toBeVisible({ timeout: 6_000 });

  // 3. The minimized bar's 2 opens Agent Link and only the link is sent.
  const pip = dialog.getByRole("region", { name: "방금그거뭐였지 작은 창" });
  await expect(pip.getByText(/링크 준비됨/)).toBeVisible({ timeout: 8_000 });
  await expect(chat.getByText(/whatwas\.vercel\.app\/context\//).first()).toBeVisible({ timeout: 6_000 });

  // 4. The AI points at the toast, the fix lands and the export downloads.
  await expect(chat.getByText("03:12:02 · 저장 직후")).toBeVisible({ timeout: 8_000 });
  await expect(dialog.getByRole("region", { name: "코드 에디터" }).getByText(/pointer-events: none/)).toBeVisible({ timeout: 6_000 });
  await expect(dialog.getByRole("region", { name: "브라우저" }).getByText("users.csv")).toBeVisible({ timeout: 6_000 });
  await expect(dialog.getByRole("button", { name: /다시 보기/ })).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText("“버튼이 안 눌려요”, 한 번에 해결")).toBeVisible();
});

test("실제 활용 예시 디자이너: 캡처에 안 찍히는 번쩍임을 링크 하나로 팀 전원이 같이 보고, 개발자의 AI가 원인을 찾는다", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(url);
  await page.getByRole("button", { name: "실제 활용 예시", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "실제 활용 예시" });
  await dialog.getByRole("region", { name: "직업 고르기" }).getByRole("button", { name: /디자이너/ }).click();
  await expect(dialog.getByRole("navigation", { name: "직업 선택" }).getByRole("button", { name: "디자이너" })).toHaveAttribute("aria-pressed", "true");
  const chat = dialog.getByRole("region", { name: "팀 채팅" });

  // 1. Screenshots miss the flash; the developer can't see it.
  await expect(dialog.getByText("…번쩍임은 안 찍힘")).toBeVisible({ timeout: 8_000 });
  await expect(chat.getByText(/제 쪽에선 안 보여요/)).toBeVisible({ timeout: 8_000 });
  await expect(chat.getByText(/코드상 다크모드 처리는 정상/)).toBeVisible({ timeout: 8_000 });

  // 2. One link in the channel: the whole team opens the same screen.
  const shared = dialog.getByRole("region", { name: "공유된 화면" });
  await expect(shared.getByText("지금 보는 중 3명")).toBeVisible({ timeout: 10_000 });
  await expect(chat.getByText("3명이 이 화면을 봤어요")).toBeVisible();
  await expect(chat.getByText(/이제 이해됨/)).toBeVisible({ timeout: 4_000 });
  await expect(chat.getByText(/안드로이드 크롬에서도/)).toBeVisible({ timeout: 4_000 });

  // 3. The developer's AI reads the same link and the fix ships.
  await expect(chat.getByText("01:24:07 · 라이트로 그려진 첫 화면")).toBeVisible({ timeout: 8_000 });
  await expect(dialog.getByRole("region", { name: "스테이징 사이트" }).getByText("새 배포")).toBeVisible({ timeout: 6_000 });
  await expect(dialog.getByRole("button", { name: /다시 보기/ })).toBeVisible({ timeout: 10_000 });
  await expect(dialog.getByText("“이 번쩍임, 저만 보여요?”, 한 번에 해결")).toBeVisible();
});

test("실제 활용 예시 03: 캡처는 놓치고, 말로 설명하면 노란 것만 다 사라지고, Manual로 자른 화면을 끌어다 주면 노란 네모가 사라진다", async ({ page }) => {
  test.setTimeout(120_000);
  let apiCalls = 0;
  await page.route("**/api/analyze", (route) => { apiCalls++; return route.abort(); });
  await page.goto(url);

  // The stage no longer offers the recorded 30-second demo.
  await expect(page.getByRole("button", { name: "30초 체험하기" })).toHaveCount(0);
  await page.getByRole("button", { name: "실제 활용 예시", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "실제 활용 예시" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("region", { name: "직업 고르기" }).getByRole("button", { name: /게임 개발자/ }).click();
  await expect(dialog.getByRole("navigation", { name: "직업 선택" }).getByRole("button", { name: "게임 개발자" })).toHaveAttribute("aria-pressed", "true");
  const chat = dialog.getByRole("region", { name: "Claudy 대화" });

  // 1. Attacking flashes the stray square while the hero still has hair.
  await expect.poll(() => hasSquare(page), { timeout: 6_000, intervals: [50] }).toBe(true);
  expect(await hasHair(page)).toBe(true);
  expect(await hasSun(page)).toBe(true);
  expect(await yellowButtonGone(page)).toBe(false);

  // 2. A screenshot attempt misses it.
  await expect(dialog.getByText(/캡처 도구 · 사각형 모드/)).toBeVisible({ timeout: 6_000 });
  await expect(dialog.getByText("노란 네모가 안 찍혔다…")).toBeVisible({ timeout: 5_000 });

  // 3. Explaining it in words: the AI removes everything else that is yellow.
  await expect(chat.getByText("야 공격할 때 노란색 이펙트 생기는 거 뭐냐? 이거 없애줘")).toBeVisible({ timeout: 8_000 });
  await expect(chat.getByText(/완료했어요/)).toBeVisible({ timeout: 6_000 });
  await expect.poll(() => hasHair(page), { timeout: 4_000 }).toBe(false);
  expect(await hasSun(page)).toBe(false);
  expect(await yellowButtonGone(page)).toBe(true);
  await expect.poll(() => hasSquare(page), { timeout: 4_000, intervals: [50] }).toBe(true);

  // 4. The Manual picker finds the in-between frame and crops the square.
  const pip = dialog.getByRole("region", { name: "방금그거뭐였지 작은 창" });
  await expect(pip.getByText("화면 선택")).toBeVisible({ timeout: 8_000 });
  await expect(pip.locator('[data-middle="true"]')).toHaveCount(2, { timeout: 3_000 });
  await expect(pip.getByText("영역 선택")).toBeVisible({ timeout: 3_000 });
  await expect(pip.getByText("선택 취소")).toBeVisible({ timeout: 4_000 });

  // 5. Dragged into the chat, sent, and fixed: hair and sun back, no square.
  await expect(chat.locator("[class*=attachment]")).toBeVisible({ timeout: 5_000 });
  await expect(chat.getByText("이거 이펙트 없애줘!")).toBeVisible({ timeout: 5_000 });
  await expect(chat.locator("[class*=messageImages] [class*=messageImage]")).toBeVisible();
  await expect(chat.getByText(/debug_hitbox = false/)).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => hasHair(page), { timeout: 3_000 }).toBe(true);
  expect(await hasSun(page)).toBe(true);
  expect(await yellowButtonGone(page)).toBe(false);
  const sawSquareAfterFix = await page.evaluate(() => new Promise<boolean>((resolve) => {
    const svg = document.querySelector("[class*=gameCanvas] svg");
    let seen = false;
    const started = performance.now();
    const check = () => {
      if (svg?.querySelector('rect[fill="#ffe600"]')) seen = true;
      if (performance.now() - started < 3_500) requestAnimationFrame(check); else resolve(seen);
    };
    check();
  }));
  expect(sawSquareAfterFix).toBe(false);

  // 6. End card, replay and close.
  await expect(dialog.getByRole("button", { name: /다시 보기/ })).toBeVisible({ timeout: 8_000 });
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(apiCalls).toBe(0);
});

test("프로젝트 개요의 마지막 버튼은 실제 활용 예시로 이어진다", async ({ page }) => {
  await page.goto(url);
  await page.getByRole("button", { name: "프로젝트 개요" }).click();
  const overview = page.getByRole("dialog", { name: "프로젝트 개요" });
  await expect(overview).toBeVisible();
  for (let index = 0; index < 3; index++) await page.keyboard.press("ArrowRight");
  await overview.getByRole("button", { name: /실제 활용 예시 보기/ }).click({ timeout: 10_000 });
  await expect(overview).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "실제 활용 예시" })).toBeVisible();
});
