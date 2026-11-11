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
  // Eight stages require two worker observations each, separated by the real n8n 2s Wait node.
  await expect(page.getByRole("status")).toHaveText("초안 준비됨", { timeout: 45000 });
  await expect(page.getByRole("link", { name: "TXT 내려받기", exact: true })).toBeVisible();
  return loadRun(page);
}

export function expectCommand(command: Action, type: Action["type"], expectedVersion: number) {
  expect(command.type).toBe(type);
  expect(command.expectedVersion).toBe(expectedVersion);
  expect(command.operationId).toMatch(/^[a-f0-9-]{36}$/);
  expect(Object.keys(command).sort()).toEqual(
    ["type", "expectedVersion", "operationId", ...(type === "feedback" ? ["feedback"] : [])].sort(),
  );
}

export async function clickAction(page: Page, label: string, type: Action["type"]) {
  const before = await loadRun(page);
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/runs/${before.id}/actions`),
  );
  await page.getByRole("button", { name: label, exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const command: Action = response.request().postDataJSON();
  expectCommand(command, type, before.version);
  return { command, before, after: (await response.json()) as Run };
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
  await expect(page.locator("#pipeline > li > span")).toHaveText(stages.map(([, name]) => name));
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
