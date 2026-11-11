import { expect, test } from "@playwright/test";
import type { Action } from "../automation/editorial/ui/shared/api";
import { checkAccessibility } from "./accessibility";
import {
  clickAction,
  downloadedBytes,
  expectCommand,
  expectFullResults,
  loadRun,
  ready,
  stages,
} from "./writing";

test("글감 → 새로고침 복구 → 실제 TXT → 수정과 이전 초안 보존", async ({ page }, testInfo) => {
  await page.goto("/write/");
  await expect(page.getByLabel("글감과 원하는 결과")).toBeVisible();
  await checkAccessibility(page, testInfo, "compose");
  const idea = `쇼핑몰 구조 ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel("글감과 원하는 결과").fill(idea);
  await page.reload();
  await expect(page.getByLabel("글감과 원하는 결과")).toHaveValue(idea);
  await page.getByRole("button", { name: "초안 만들기", exact: true }).click();
  await expect(page.getByRole("heading", { name: idea, exact: true })).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(page).toHaveURL(url);
  const download = page.getByRole("link", { name: "TXT 내려받기", exact: true });
  const initial = await ready(page);
  expect(initial).toMatchObject({
    revision: 1,
    callsUsed: 8,
    maxCalls: 8,
    needsCompletion: false,
    canSatisfy: true,
    canAuthorizePublication: false,
  });
  expect(initial.artifacts.every((artifact) => artifact.reusedFromRevision === undefined)).toBe(
    true,
  );
  await expect(page.locator("#article")).toContainText("첫 초안입니다. 주문과 결제를 나누는 이유");
  await expectFullResults(page, initial);
  const originalViewport = page.viewportSize();
  if (!originalViewport) throw new Error("Viewport must be configured");
  for (const [width, columns] of [
    [390, 2],
    [700, 4],
    [1440, 8],
  ]) {
    await page.setViewportSize({ width, height: originalViewport.height });
    expect(
      await page
        .locator("#pipeline")
        .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
    ).toBe(columns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize(originalViewport);
  await checkAccessibility(page, testInfo, "ready-stage-results");
  const viewRoute = `**/write/api/runs/${initial.id}`;
  await page.route(viewRoute, async (route) => {
    const response = await route.fetch();
    const view = await response.json();
    view.artifacts.find(
      (artifact: { stage: string }) => artifact.stage === "research",
    ).output.evidence = [
      { claim: "안전한 HTTPS 근거", url: "https://example.test/evidence" },
      { claim: "안전한 HTTP 근거", url: "http://example.test/evidence" },
      { claim: "위험한 주소의 설명 보존", url: "javascript:alert(1)" },
      { claim: "잘못된 주소의 설명 보존", url: "not a URL" },
    ];
    await route.fulfill({ response, json: view });
  });
  await page.reload();
  await page.locator("#stage-details > summary").click();
  const research = page.locator('#artifacts details[data-stage="research"]');
  await research.locator("summary").click();
  await expect(research.locator("a")).toHaveCount(2);
  for (const protocol of ["https", "http"]) {
    const evidence = research.getByRole("link", {
      name: `${protocol}://example.test/evidence`,
      exact: true,
    });
    await expect(evidence).toHaveAttribute("href", `${protocol}://example.test/evidence`);
    await expect(evidence).toHaveAttribute("target", "_blank");
    await expect(evidence).toHaveAttribute("rel", "noopener noreferrer");
  }
  await expect(research).toContainText("위험한 주소의 설명 보존");
  await expect(research).toContainText("잘못된 주소의 설명 보존");
  await expect(
    research.getByText("확인할 수 있는 출처 주소가 없습니다.", { exact: true }),
  ).toHaveCount(2);
  await checkAccessibility(page, testInfo, "stage-evidence");
  await page.unroute(viewRoute);
  await page.reload();
  await expect(page.getByRole("button", { name: "초안 확정", exact: true })).toBeVisible();
  const confirmed = await clickAction(page, "초안 확정", "satisfy");
  expect(confirmed.after).toMatchObject({
    status: "satisfied",
    revision: 1,
    callsUsed: 8,
    maxCalls: 8,
    canSatisfy: false,
    canAuthorizePublication: true,
  });
  expect(confirmed.after.version).toBe(initial.version + 1);
  await expect(page.getByRole("status")).toHaveText("초안 확정");
  await checkAccessibility(page, testInfo, "satisfied");
  const authorized = await clickAction(page, "발행 준비 승인", "authorize_publication");
  expect(authorized.after).toMatchObject({
    status: "publication_ready",
    revision: 1,
    callsUsed: 8,
    maxCalls: 8,
    canSatisfy: false,
    canAuthorizePublication: false,
  });
  expect(authorized.after.version).toBe(initial.version + 2);
  expect(authorized.after.artifacts).toEqual(initial.artifacts);
  expect(authorized.after.text).toBe(initial.text);
  expect(authorized.after.previous).toEqual(initial.previous);
  await expect(page.getByRole("status")).toHaveText("발행 준비 승인");
  await expect(page.locator("#draft-approval")).toContainText("실제 발행은 별도로 진행합니다.");
  await page.reload();
  expect((await loadRun(page)).status).toBe("publication_ready");
  await expect(page.getByRole("status")).toHaveText("발행 준비 승인");
  await checkAccessibility(page, testInfo, "publication-approved");
  const filePromise = page.waitForEvent("download");
  await download.click();
  const file = await filePromise;
  const text = (await downloadedBytes(file)).toString("utf8");
  expect(text).toContain(idea);
  expect(text).toContain("첫 초안입니다.");
  await page.getByLabel("어떻게 다듬을까요?").fill("주문·결제·배송 예시를 더 자세히 풀어 주세요.");
  await page.reload();
  await expect(page.getByLabel("어떻게 다듬을까요?")).toHaveValue(
    "주문·결제·배송 예시를 더 자세히 풀어 주세요.",
  );
  let feedbackCommand: Action | undefined;
  let feedbackResult: unknown;
  await page.route(
    "**/actions",
    async (route) => {
      feedbackCommand = route.request().postDataJSON();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      feedbackResult = await response.json();
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "수정 요청", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("연결하지 못했습니다");
  if (!feedbackCommand) throw new Error("Feedback command was not sent");
  expectCommand(feedbackCommand, "feedback", authorized.after.version);
  expect(feedbackResult).toMatchObject({
    revision: 2,
    status: "waiting_route",
    maxCalls: 9,
    canSatisfy: false,
    canAuthorizePublication: false,
  });
  await page.reload();
  await expect(page.locator("#revision")).toHaveText("초안 2");
  await expect(page.locator("#displayed-revision")).toHaveText("이전 초안 1");
  await expect(download).toBeVisible();
  await expect(page.locator("#article")).toContainText("수정한 초안입니다. 주문·결제·배송");
  const revised = await ready(page);
  expect(revised).toMatchObject({
    revision: 2,
    callsUsed: 3,
    maxCalls: 9,
    canSatisfy: true,
    canAuthorizePublication: false,
  });
  expect(
    revised.artifacts
      .slice(0, 6)
      .map((artifact) => [artifact.stage, artifact.revision, artifact.reusedFromRevision]),
  ).toEqual(stages.slice(0, 6).map(([stage]) => [stage, 2, 1]));
  expect(
    revised.artifacts.slice(6).every((artifact) => artifact.reusedFromRevision === undefined),
  ).toBe(true);
  expect(
    revised.appliedOperations.filter((id) => id === feedbackCommand?.operationId),
  ).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem("ain-editorial-operation"))).toBeNull();
  await expect(page.getByRole("button", { name: "발행 준비 승인", exact: true })).toBeHidden();
  await page.getByText("초안 1 보기", { exact: true }).click();
  await expect(page.locator("#history pre")).toHaveText(text.trimEnd());
  const oldFile = page.waitForEvent("download");
  await page.getByRole("link", { name: "이 초안 내려받기", exact: true }).click();
  expect((await downloadedBytes(await oldFile)).toString("utf8")).toBe(text);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `.local/editorial-qa/${testInfo.project.name}-result.png`,
    fullPage: true,
  });
});

test("진행 중 중단 → 새로고침 → 같은 글 이어가기", async ({ page }, testInfo) => {
  await page.goto("/write/");
  const idea = `중단 복구 ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel("글감과 원하는 결과").fill(idea);
  await page.getByRole("button", { name: "초안 만들기", exact: true }).click();
  await expect(page.locator('#pipeline li[aria-current="step"]')).toContainText("초고 작성", {
    timeout: 45000,
  });
  await expect(page.getByRole("status")).toHaveText("초고 작성 중");
  const waiting = await loadRun(page);
  expect(waiting).toMatchObject({ callsUsed: 7, maxCalls: 8, revision: 1 });
  await expect(page.getByRole("status")).toHaveAttribute("data-busy", "");
  await checkAccessibility(page, testInfo, "working");
  await clickAction(page, "중단", "pause");
  await expect(page.getByRole("status")).toHaveText("중단됨");
  const url = page.url();
  await page.reload();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole("status")).toHaveText("중단됨");
  await checkAccessibility(page, testInfo, "paused");
  expect(await loadRun(page)).toMatchObject({ callsUsed: 7, maxCalls: 8, revision: 1 });
  const resumed = await clickAction(page, "이어가기", "resume");
  expect(resumed.after).toMatchObject({ callsUsed: 0, maxCalls: 9, revision: 1 });
  const completed = await ready(page);
  expect(completed).toMatchObject({ callsUsed: 2, maxCalls: 9, revision: 1 });
  await expect(page.locator("#revision")).toHaveText("초안 1");
  await expect(page.locator("#article")).toContainText(idea);
});

test("AI 결과 오류 → 보존 상태 확인 → 이어가기", async ({ page }, testInfo) => {
  await page.goto("/write/");
  const idea = `실패 복구 ${testInfo.project.name} ${Date.now()}`;
  await page.getByLabel("글감과 원하는 결과").fill(idea);
  await page.getByRole("button", { name: "초안 만들기", exact: true }).click();
  await expect(page.locator("#issue")).toContainText("AI 작업을 완료하지 못했습니다", {
    timeout: 45000,
  });
  await expect(page.getByRole("link", { name: "TXT 내려받기", exact: true })).toBeHidden();
  await checkAccessibility(page, testInfo, "failure");
  expect(await loadRun(page)).toMatchObject({ callsUsed: 7, maxCalls: 8, revision: 1 });
  const retried = await clickAction(page, "이어가기", "resume");
  expect(retried.after).toMatchObject({ callsUsed: 0, maxCalls: 9, revision: 1 });
  expect(await ready(page)).toMatchObject({ callsUsed: 2, maxCalls: 9, revision: 1 });
  await expect(page.locator("#article")).toContainText(idea);
});

test("실제 확인 시각·실행 이력·연결 단절 표시와 빈 영역 제거", async ({ page }, testInfo) => {
  await page.goto("/write/");
  await expect(page.getByRole("button", { name: "새 글", exact: true })).toBeHidden();
  await page
    .getByLabel("글감과 원하는 결과")
    .fill(`상태 추적 빈 검토 ${testInfo.project.name} ${Date.now()}`);
  await page.getByRole("button", { name: "초안 만들기", exact: true }).click();
  await expect(page.locator("#confirmed")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/대기|중/);
  const viewRoute = /\/write\/api\/runs\/[^/]+$/;
  await page.route(viewRoute, (route) => route.abort("failed"));
  await expect(page.getByRole("status")).toHaveText("상태 확인 불가");
  await expect(page.getByRole("button", { name: "중단", exact: true })).toBeDisabled();
  await page.unroute(viewRoute);
  await ready(page);
  await expect(page.locator("#review")).toBeHidden();
  await expect(page.locator("#saved")).toHaveCount(0);
  await page.locator("#record-title").click();
  await page.getByText("문제 진단용 실행 기록", { exact: true }).click();
  for (const [, name] of stages) await expect(page.locator("#trace")).toContainText(`${name} 완료`);
  const runId = new URL(page.url()).hash.slice(1);
  const run = await (await page.request.get(`/write/api/runs/${runId}`)).json();
  expect(run.monitor.executionId).toBeTruthy();
  await expect(page.locator("#execution-links a").last()).toHaveAttribute(
    "href",
    new RegExp(`/executions/${run.monitor.executionId}$`),
  );
  const events = run.monitor.events;
  await page.reload();
  await page.locator("#record-title").click();
  await page.getByText("문제 진단용 실행 기록", { exact: true }).click();
  const restored = await (await page.request.get(`/write/api/runs/${runId}`)).json();
  expect(restored.monitor.events).toEqual(events);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `.local/editorial-qa/${testInfo.project.name}-monitor.png`,
    fullPage: true,
  });
});

test("LIVE-001: 실시간 내용·새로고침 복구·연결 단절·중단", async ({ page }, testInfo) => {
  await page.goto("/write/");
  await page
    .getByLabel("글감과 원하는 결과")
    .fill(`실시간 미리보기 ${testInfo.project.name} ${Date.now()}`);
  await page.getByRole("button", { name: "초안 만들기", exact: true }).click();
  const live = page.locator("#live-activity");
  await expect(live.locator("h2")).toHaveText("초고 작성");
  const preview = live.getByRole("region", { name: "생성 중인 내용", exact: true });
  await expect(preview).toContainText("첫 초안");
  const before = (await preview.textContent()) ?? "";
  await expect
    .poll(async () => ((await preview.textContent()) ?? "").length)
    .toBeGreaterThan(before.length);
  await page.reload();
  await expect(preview).toContainText("첫 초안");
  await page.context().setOffline(true);
  await expect(live).toContainText("연결이 끊겼습니다");
  await expect(preview).toContainText("첫 초안");
  await page.context().setOffline(false);
  await page.getByRole("button", { name: "중단", exact: true }).click();
  await expect(page.locator("#status")).toContainText("중단");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await checkAccessibility(page, testInfo, "live-preview-paused");
});

test("HISTORY-001: 작성 방향·수정 요약·확인할 점을 과거 초안과 함께 보존", async ({
  page,
}, testInfo) => {
  await page.goto("/write/");
  await page
    .getByLabel("글감과 원하는 결과")
    .fill(`과정 기록 ${testInfo.project.name} ${Date.now()}`);
  await page.getByRole("button", { name: "초안 만들기", exact: true }).click();
  const first = await ready(page);
  await expect(page.locator("#artifacts")).toBeHidden();
  await expectFullResults(page, first);
  await page.locator("#stage-details > summary").click();
  await page.getByLabel("어떻게 다듬을까요?").fill("주문 사례를 더 자세히 설명해 주세요.");
  await clickAction(page, "수정 요청", "feedback");
  await expect(page.locator("#revision")).toHaveText("초안 2");
  const second = await ready(page);
  await page.locator("#record-title").click();
  const current = page
    .locator("#writing-journey > details")
    .filter({ has: page.getByText("초안 2 · 현재", { exact: true }) });
  await expect(current).toContainText("주문 사례를 더 자세히 설명해 주세요.");
  await expect(current).toContainText("주문·결제·배송의 책임을 구체화했습니다.");
  await expect(current).toContainText("읽으며 확인할 점");
  await expect(current.getByRole("heading", { name: "작성 방향", exact: true })).toHaveCount(0);
  await expect(page.locator("#execution-info")).toBeHidden();
  await expect(page.locator("#trace")).toBeHidden();
  const previous = page
    .locator("#writing-journey > details")
    .filter({ has: page.getByText("초안 1 · 이전", { exact: true }) });
  await previous.locator(":scope > summary").click();
  await expect(previous).toContainText("초보 개발자");
  await expect(previous).toContainText("주문 → 결제 → 배송");
  const endpoint = `/write/api/runs/${first.id}/history`;
  const history = await (await page.request.get(endpoint)).json();
  await page.reload();
  await page.locator("#record-title").click();
  await expect(current).toContainText("주문·결제·배송의 책임을 구체화했습니다.");
  expect(await (await page.request.get(endpoint)).json()).toEqual(history);
  const after = await loadRun(page);
  expect(after.callsUsed).toBe(second.callsUsed);
  expect(after.version).toBe(second.version);
  await checkAccessibility(page, testInfo, "writing-journey");
});
