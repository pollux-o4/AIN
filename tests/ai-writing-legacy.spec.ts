import { expect, test } from "@playwright/test";
import type { Action } from "../automation/editorial/ui/shared/api";
import { checkAccessibility } from "./accessibility";
import { downloadedBytes, expectCommand, expectFullResults, loadRun, ready } from "./writing";

test("이전 3단계: 열람은 불변 → 명시적 보완 응답 유실 → 회차 2와 정확한 이전 TXT 보존", async ({
  page,
}, testInfo) => {
  const device = testInfo.project.name;
  const id = `00000000-0000-4000-8000-00000000000${device === "desktop" ? 1 : 2}`;
  const oldText = `# 이전 초안 ${device}\n\n이전 3단계 원고를 그대로 보존합니다.`;
  const oldBytes = Buffer.from(`${oldText}\n`, "utf8");
  await page.goto("/write/");
  const original = await loadRun(page, id);
  expect(original).toMatchObject({
    version: 4,
    revision: 1,
    callsUsed: 3,
    maxCalls: 3,
    status: "awaiting_user",
    text: oldText,
    textRevision: 1,
    previous: [],
    needsCompletion: true,
    canCompleteRequirements: true,
    canSatisfy: false,
    canAuthorizePublication: false,
    canFeedback: false,
    monitor: { events: [], executionId: null, canResume: false },
  });
  await page.getByRole("button", { name: new RegExp(`이전 초안 ${device}`) }).click();
  await expect(page).toHaveURL(new RegExp(`#${id}$`));
  await expect(page.locator("#completion-notice")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("요구사항 보완 필요");
  await expect(page.getByRole("button", { name: "초안 확정", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "이어가기", exact: true })).toBeHidden();
  await expect(page.getByLabel("어떻게 다듬을까요?")).toBeHidden();
  await checkAccessibility(page, testInfo, "legacy-completion-notice");
  await page.reload();
  await expect(page.locator("#completion-notice")).toBeVisible();
  const unchanged = await loadRun(page, id);
  for (const field of [
    "version",
    "revision",
    "callsUsed",
    "maxCalls",
    "updatedAt",
    "artifacts",
    "appliedOperations",
  ] as const) {
    expect(unchanged[field]).toEqual(original[field]);
  }
  expect(unchanged.monitor.events).toEqual([]);
  expect(unchanged.monitor.executionId).toBeNull();
  const oldDownload = await page.request.get(`/write/api/runs/${id}/download`);
  expect(oldDownload.ok()).toBe(true);
  expect(await oldDownload.body()).toEqual(oldBytes);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "TXT 내려받기", exact: true }).click();
  expect(await downloadedBytes(await downloadPromise)).toEqual(oldBytes);

  let command: Action | undefined;
  await page.route(
    "**/actions",
    async (route) => {
      command = route.request().postDataJSON();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({
        revision: 2,
        maxCalls: 8,
        text: oldText,
        textRevision: 1,
      });
      await route.abort("failed");
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "필수 단계 보완", exact: true }).click();
  await expect(page.locator("#notice")).toContainText("연결하지 못했습니다");
  if (!command) throw new Error("Completion command was not sent");
  expectCommand(command, "complete_requirements", 4);
  await page.reload();
  await expect(page.locator("#revision")).toHaveText("초안 2");
  await expect(page.locator("#displayed-revision")).toHaveText("이전 초안 1");
  await expect(page.locator("#article")).toContainText("이전 3단계 원고를 그대로 보존합니다.");
  await expect(page.locator("#completion-notice")).toBeHidden();
  // Replaying the exact acknowledged operation must not create revision 3 or reset its budget.
  const beforeReplay = await loadRun(page, id);
  const missingOrigin = await page.request.post(`/write/api/runs/${id}/actions`, { data: command });
  expect(missingOrigin.status()).toBe(403);
  expect(await missingOrigin.json()).toEqual({ error: "글쓰기 화면에서 요청해 주세요." });
  const replay = await page.request.post(`/write/api/runs/${id}/actions`, {
    data: command,
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(replay.ok()).toBe(true);
  expect(await replay.json()).toMatchObject({ revision: 2, maxCalls: 8 });
  const afterReplay = await loadRun(page, id);
  expect(afterReplay.previous).toEqual(beforeReplay.previous);
  expect(afterReplay.callsUsed).toBeGreaterThanOrEqual(beforeReplay.callsUsed);
  const completed = await ready(page);
  expect(completed).toMatchObject({
    revision: 2,
    callsUsed: 8,
    maxCalls: 8,
    canSatisfy: true,
    canAuthorizePublication: false,
  });
  expect(completed.previous).toEqual([expect.objectContaining({ revision: 1, text: oldText })]);
  expect(
    completed.appliedOperations.filter((operation) => operation === command?.operationId),
  ).toHaveLength(1);
  expect(
    completed.monitor.events.filter((event) => event.label === "전체 요구사항 보완 요청"),
  ).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem("ain-editorial-operation"))).toBeNull();
  await expectFullResults(page, completed);
  await page.getByText("초안 1 보기", { exact: true }).click();
  await expect(page.locator("#history pre")).toHaveText(oldText);
  const historical = await page.request.get(`/write/api/runs/${id}/download?revision=1`);
  expect(historical.ok()).toBe(true);
  expect(await historical.body()).toEqual(oldBytes);
  const historyPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "이 초안 내려받기", exact: true }).click();
  expect(await downloadedBytes(await historyPromise)).toEqual(oldBytes);
  await page.reload();
  await expect(page.locator("#revision")).toHaveText("초안 2");
  const restored = await loadRun(page, id);
  expect(restored.version).toBe(completed.version);
  expect(restored.callsUsed).toBe(8);
  expect(restored.monitor.events).toEqual(completed.monitor.events);
  await checkAccessibility(page, testInfo, "legacy-completed");
});
