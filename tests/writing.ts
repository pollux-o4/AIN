import { readFile } from "node:fs/promises";
import { type Download, expect, type Page } from "@playwright/test";
import type { Action, Run } from "../automation/editorial/ui/shared/api";

export const stages = [
  ["diagnose", "진단", "글의 목적"],
  ["topic", "주제 정리", "다룰 문제"],
  ["audience", "독자 정리", "대상 독자"],
  ["value", "핵심 정리", "전달할 가치"],
  ["research", "근거 정리", "근거와 출처"],
  ["outline", "구성", "글의 구성"],
  ["draft", "초고 작성", "초안 본문"],
  ["review", "검토", "검토 의견"],
] as const;

export async function loadRun(
  page: Page,
  id = new URL(page.url()).hash.slice(1),
): Promise<Run & { updatedAt: number }> {
  const response = await page.request.get(`/write/api/runs/${id}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

export async function ready(page: Page) {
  // 화면 e2e는 n8n과 같은 계약의 프로세스 내 전달자 사용 · 느린 fixture(중단·실시간) 여유 포함
  await expect(page.getByRole("status")).toHaveText("초안 준비됨", { timeout: 45000 });
  await expect(page.getByRole("link", { name: "TXT 내려받기", exact: true })).toBeVisible();
  return loadRun(page);
}

export function expectCommand(command: Action, type: Action["type"], expectedVersion: number) {
  expect(command.type).toBe(type);
  expect(command.expectedVersion).toBe(expectedVersion);
  expect(command.operationId).toMatch(/^[a-f0-9-]{36}$/);
  expect(Object.keys(command).sort()).toEqual(
    [
      "type",
      "expectedVersion",
      "operationId",
      ...(["feedback", "revise_brief"].includes(type) ? ["feedback"] : []),
      ...(type === "approve_brief" && "edit" in command ? ["edit"] : []),
      ...("figures" in command ? ["figures"] : []),
      ...(type === "select_figures" && "directions" in command ? ["directions"] : []),
    ].sort(),
  );
}

export async function clickAction(page: Page, label: string, type: Action["type"]) {
  const before = await loadRun(page);
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/runs/${before.id}/actions`),
  );
  const button = page.getByRole("button", { name: label, exact: true });
  // 접힌 도크 안 버튼은 투명할 뿐 visible로 잡히므로 inert 여부로 판단
  if (await button.evaluate((el) => Boolean(el.closest("[inert]")))) await openDock(page, "확인");
  await button.click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const command: Action = response.request().postDataJSON();
  expectCommand(command, type, before.version);
  return { command, before, after: (await response.json()) as Run };
}

// 사용자 입력은 떠 있는 작업 도크에서 받는다(DOCK-001) · 접혀 있으면 펼치고 탭이 있으면 고른다
export async function openDock(page: Page, tab: "확인" | "실시간" | "수정 요청") {
  const toggle = page.locator("#work-dock .dock-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const tabButton = page.getByRole("tab", { name: tab, exact: true });
  if (await tabButton.isVisible()) await tabButton.click();
}

export async function writeFeedback(page: Page, text: string) {
  await openDock(page, "수정 요청");
  await page.getByLabel("어떻게 다듬을까요?").fill(text);
}

// 수정 요청 뒤 편집장 해석을 사람이 승인 · ADR-0010
export async function approveBrief(page: Page) {
  await expect(page.locator("#brief-approve")).toBeVisible({ timeout: 45000 });
  return clickAction(page, "이대로 진행", "approve_brief");
}

export async function expectFullResults(page: Page, run: Run) {
  if (
    !(await page
      .locator("#stage-details")
      .evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await page.locator("#stage-details > summary").click();
  expect(run.artifacts.map((artifact) => artifact.stage)).toEqual(stages.map(([stage]) => stage));
  expect(run.artifacts.every((artifact) => artifact.revision === run.revision)).toBe(true);
  expect(run.monitor.pipeline.map((step) => [step.stage, step.status])).toEqual(
    stages.map(([stage]) => [stage, "done"]),
  );
  await expect(page.locator("#pipeline > li span")).toHaveText(stages.map(([, name]) => name));
  await expect(page.locator('#pipeline > li[data-status="done"]')).toHaveCount(8);
  await expect(page.locator("#artifacts > details")).toHaveCount(8);
  for (const [stage, name, field] of stages) {
    const detail = page.locator(`#artifacts details[data-stage="${stage}"]`);
    await expect(detail.locator("summary")).toHaveText(`${name} · 현재 회차 ${run.revision}`);
    await detail.locator("summary").click();
    await expect(detail.locator("dt", { hasText: field }).first()).toBeVisible();
  }
  const results = await page.locator("#artifacts").textContent();
  expect(results).not.toMatch(
    /"(?:purpose|problem|reader|outcome|evidence|sections|text|findings)"\s*:/,
  );
  expect(await page.locator("#artifacts pre").count()).toBe(0);
}

export async function downloadedBytes(download: Download) {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  if (!path) throw new Error("Download did not produce a local file");
  return readFile(path);
}
