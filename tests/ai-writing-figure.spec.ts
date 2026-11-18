import { expect, type Page, test } from "@playwright/test";
import { checkAccessibility } from "./accessibility";
import { clickAction, downloadedBytes, loadRun, openDock, ready } from "./writing";

// FIGURE-001: 초안 확정 → [시각자료 추가 → 확인] 또는 [시각자료 없이] → 발행 준비 승인 · AI는 fixture
async function confirmedDraft(page: Page, name: string) {
  await page.goto("/write/#new");
  await page.getByLabel("글감과 원하는 결과").fill(`시각자료 ${name} ${Date.now()}`);
  await page.getByRole("button", { name: "초안 만들기", exact: true }).click();
  const first = await ready(page);
  await clickAction(page, "초안 확정", "satisfy");
  return first;
}
const articleText = (page: Page) =>
  page.locator("#article").evaluate((article) => {
    const copy = article.cloneNode(true) as HTMLElement;
    for (const figure of copy.querySelectorAll("figure")) figure.remove();
    return copy.textContent;
  });

test("FIGURE-001: 위치를 고르고 확인한 시각자료만 본문 뒤에 놓이고, 승인은 그 뒤", async ({
  page,
}, testInfo) => {
  const first = await confirmedDraft(page, testInfo.project.name);
  const body = await articleText(page);

  // 확정 뒤 두 선택지가 같은 위계로 · 안내 문구도 두 선택지 기준
  await openDock(page, "확인");
  const approval = page.locator("#draft-approval");
  await expect(approval).toContainText(
    "시각자료를 추가하거나, 없이 바로 발행 준비를 승인할 수 있습니다.",
  );
  const add = page.getByRole("button", { name: "시각자료 추가", exact: true });
  const authorize = page.getByRole("button", { name: "발행 준비 승인", exact: true });
  await expect(add).toBeVisible();
  await expect(authorize).toBeVisible();
  expect(await add.evaluate((el) => el.className)).toBe(
    await authorize.evaluate((el) => el.className),
  );
  expect(await add.evaluate((el) => el.parentElement?.className)).toBe("approval-actions");
  await expect(page.locator("#next-step")).toContainText("시각자료를 추가하거나");
  await checkAccessibility(page, testInfo, "figure-entry");

  // 위치 제안: 본문에 있는 문장만 후보 · 고르기 전에는 생성 없음
  await clickAction(page, "시각자료 추가", "request_figures");
  const choice = page.locator("#figure-choice");
  await expect(choice).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole("status")).toHaveText("시각자료 위치 선택 대기");
  await expect(choice.getByRole("checkbox")).toHaveCount(2);
  await expect(choice).not.toContainText("버려져야 하는 후보");
  await expect(choice).toContainText("‘주문’ 구간");
  const proposed = await loadRun(page);
  expect(proposed).toMatchObject({
    status: "awaiting_figure_choice",
    canAuthorizePublication: false,
  });
  expect(proposed.callsUsed).toBe(1);
  await expect(page.locator("#article figure")).toHaveCount(0);
  // 시각 단계로 넘어가면 끝난 글 단계는 한 칸으로 접히고, 눌러서 다시 펼칠 수 있다
  const fold = page.locator("#pipeline > li.phase-fold");
  await expect(fold).toContainText("글 완성");
  await expect(fold).toContainText("8단계");
  await expect(page.locator('#pipeline > li[data-status="done"]')).toHaveCount(2);
  // 모바일은 열린 작업 도크가 지도를 덮으므로 펼치기·접기는 PC에서 확인한다
  if (testInfo.project.name === "desktop") {
    await fold.getByRole("button").click();
    await expect(page.locator('#pipeline > li[data-status="done"]')).toHaveCount(9);
    await page.getByRole("button", { name: "글 단계 접기" }).click();
    await expect(fold).toBeVisible();
  }
  await checkAccessibility(page, testInfo, "figure-choice");

  // 본문 자리와 도크 목록은 같은 선택 상태 · 본문에서 빼면 도크에서도 빠진다
  const slots = page.locator("#article .figure-slot button");
  await expect(slots).toHaveCount(2);
  // 계획 단계: 유형과 반복 대상(같은 모습으로 그릴 다른 후보)을 본문 자리에서 바로 읽는다
  await expect(slots.nth(0)).toContainText("흐름");
  await expect(slots.nth(0)).toContainText("주문서 · 후보 2에도 나옴");
  await expect(choice.locator("#figure-style")).toContainText("주황 #f5a623");
  await choice.getByRole("button", { name: "본문에서 고르기" }).click();
  // 고른 후보에 방향을 덧붙인다(ADR-0023) · 접혀 있다가 펼쳐 쓰고, 새로고침해도 남는다
  const direction = page.locator("#article .figure-direction").nth(1);
  await expect(direction).not.toHaveAttribute("open");
  await direction.locator("summary").click();
  await direction.locator("textarea").fill("두 상태를 좌우로 비교");
  await expect(direction.locator("summary")).toContainText("방향 있음");
  await page.reload();
  await expect(direction.locator("summary")).toContainText("방향 있음");
  await openDock(page, "확인");
  await choice.getByRole("button", { name: "본문에서 고르기" }).click();
  await slots.nth(0).click();
  await expect(slots.nth(0)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".dock-toggle")).toContainText("1곳 골랐어요");
  await openDock(page, "확인");
  await expect(choice.getByRole("checkbox").nth(0)).not.toBeChecked();
  await choice.getByRole("checkbox").nth(0).check();

  // 아무것도 고르지 않으면 만들 수 없음 · 고른 곳만 생성
  await choice.getByRole("checkbox").nth(1).uncheck();
  await choice.getByRole("checkbox").nth(0).uncheck();
  await expect(page.locator("#select-figures")).toBeDisabled();
  await choice.getByRole("checkbox").nth(0).check();
  await choice.getByRole("checkbox").nth(1).check();
  await expect(choice.locator(".figure-option").nth(1)).toContainText("방향 있음");
  const selected = await clickAction(page, "2곳에 만들기", "select_figures");
  expect(selected.command).toMatchObject({
    figures: ["f1", "f2"],
    directions: { f2: "두 상태를 좌우로 비교" },
  });

  // 준비됨 ≠ 확인됨: 본문에 '확인 전'으로 놓이고 발행 준비 승인은 아직 불가
  const review = page.locator("#figure-review");
  await expect(review).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole("status")).toHaveText("시각자료 확인 대기");
  const figures = page.locator("#article figure");
  await expect(figures).toHaveCount(2);
  await expect(figures.first()).toContainText("확인 전");
  // 만든 그림의 계획은 접혀 있다가 펼쳐서 결과와 비교한다
  const plan = figures.first().locator("details.figure-plan-notes");
  await expect(plan).not.toHaveAttribute("open");
  // 확인 대기로 열린 도크(모바일은 시트)를 접어 본문을 본다
  const dockToggle = page.locator("#work-dock .dock-toggle");
  if ((await dockToggle.getAttribute("aria-expanded")) === "true") await dockToggle.click();
  await plan.locator("summary").evaluate((el) => el.scrollIntoView({ block: "center" }));
  await plan.locator("summary").click();
  await expect(plan).toContainText("주문·결제·배송의 책임 흐름");
  await expect(figures.nth(1).locator("details.figure-plan-notes")).toContainText(
    "내 방향 두 상태를 좌우로 비교",
  );
  await openDock(page, "확인");
  await expect(authorize).toBeHidden();
  expect(await articleText(page)).toBe(body);
  for (const image of await page.locator("#article figure img, #figure-review img").all())
    await expect(image).toHaveJSProperty("complete", true);
  expect(
    await figures
      .first()
      .locator("img")
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBeGreaterThan(0);
  // 앵커 문단 바로 뒤에 배치
  expect(
    await figures.first().evaluate((figure) => figure.previousElementSibling?.textContent),
  ).toContain("주문은 고객이 무엇을 샀는지 기록하는 책임을 집니다.");
  await checkAccessibility(page, testInfo, "figure-review");

  // 본문에서 보기: 도크를 접고 그 자리로 · 새로고침 뒤에도 확인 대기 유지
  await review.getByRole("button", { name: "본문에서 보기" }).nth(1).click();
  await expect(page.locator("#work-dock")).toHaveAttribute("data-open", "false");
  await expect(figures.nth(1)).toBeInViewport();
  await page.reload();
  await expect(review).toBeVisible();

  // 하나만 남겨 확인 · 확인한 것만 넘길 결과물에 포함
  await review.getByRole("checkbox").nth(1).uncheck();
  const confirmed = await clickAction(page, "1개만 확인", "confirm_figures");
  expect(confirmed.command).toMatchObject({ figures: ["f1"] });
  expect(confirmed.after).toMatchObject({
    status: "satisfied",
    revision: first.revision,
    canAuthorizePublication: true,
    text: first.text,
  });
  await expect(page.getByRole("status")).toHaveText("시각자료 확인됨");
  await expect(figures).toHaveCount(1);
  await expect(figures.first()).not.toContainText("확인 전");
  expect(await articleText(page)).toBe(body);

  // 파일: 본문 TXT는 그대로, 시각자료는 SVG 파일로
  const svgPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "시각자료 1 SVG" }).click();
  const svg = (await downloadedBytes(await svgPromise)).toString("utf8");
  expect(svg).toMatch(/^<svg xmlns=/);
  const txtPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "TXT 내려받기", exact: true }).click();
  expect((await downloadedBytes(await txtPromise)).toString("utf8")).toBe(`${first.text}\n`);

  // 다른 형식(ADR-0012): HTML은 확인한 그림만 격리된 img로, ZIP은 원고·그림·배치 매니페스트
  const more = page.getByRole("button", { name: "다른 형식" });
  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#export-still")).toBeVisible();
  await checkAccessibility(page, testInfo, "export-menu");
  const htmlPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "HTML 문서" }).click();
  const html = (await downloadedBytes(await htmlPromise)).toString("utf8");
  expect(html).toMatch(/^<!doctype html>/);
  expect(html.match(/<figure/g)).toHaveLength(1);
  expect(html).toContain('src="data:image/svg+xml;base64,');
  expect(html).not.toMatch(/<script/);
  await page.locator("#export-still").check();
  await expect(page.getByRole("link", { name: "묶음 ZIP" })).toHaveAttribute(
    "href",
    /motion=static/,
  );
  const zipPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "묶음 ZIP" }).click();
  const zipped = await downloadedBytes(await zipPromise);
  expect(zipped.subarray(0, 2).toString("latin1")).toBe("PK");
  const names = zipped.toString("latin1");
  for (const name of ["manifest.json", "article.md", "figures/f1.svg", "figures/f1.static.svg"])
    expect(names).toContain(name);
  expect(names).not.toContain("figures/f2.svg");
  // Esc로 닫히고 포커스는 메뉴 버튼으로
  await page.keyboard.press("Escape");
  await expect(page.locator("#export-panel")).toBeHidden();
  await expect(more).toBeFocused();

  // 승인 대상 = 본문 + 확인한 시각자료
  await openDock(page, "확인");
  await expect(approval).toContainText("시각자료 1개를 확인했습니다.");
  await checkAccessibility(page, testInfo, "figure-confirmed");
  const authorized = await clickAction(page, "발행 준비 승인", "authorize_publication");
  expect(authorized.after.status).toBe("publication_ready");
  await openDock(page, "확인");
  await expect(approval).toContainText("발행 준비를 승인했습니다(본문과 시각자료 1개)");
  await expect(page.getByRole("button", { name: "시각자료 빼기" })).toBeHidden();
  // 생성은 그림 한 장씩 초안·내용·시각 3층 = 2곳 × 3 = AI 6회 · ADR-0017
  expect((await loadRun(page)).callsUsed).toBe(6);
});

test("FIGURE-001: 시각자료 없이 진행하면 확정 상태 그대로 발행 준비를 승인", async ({
  page,
}, testInfo) => {
  const first = await confirmedDraft(page, `없이 ${testInfo.project.name}`);
  await clickAction(page, "시각자료 추가", "request_figures");
  await expect(page.locator("#figure-choice")).toBeVisible({ timeout: 45000 });
  const skipped = await clickAction(page, "시각자료 없이 진행", "discard_figures");
  expect(skipped.after).toMatchObject({
    status: "satisfied",
    figure: null,
    canRequestFigures: true,
    canAuthorizePublication: true,
    text: first.text,
  });
  await expect(page.getByRole("status")).toHaveText("초안 확정");
  await expect(page.locator("#article figure")).toHaveCount(0);
  const authorized = await clickAction(page, "발행 준비 승인", "authorize_publication");
  expect(authorized.after.status).toBe("publication_ready");
  await openDock(page, "확인");
  await expect(page.locator("#draft-approval")).toContainText("발행 준비를 승인했습니다(본문만)");
});
