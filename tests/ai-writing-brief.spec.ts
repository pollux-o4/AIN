import { expect, test } from "@playwright/test";
import { checkAccessibility } from "./accessibility";
import { clickAction, loadRun, ready, writeFeedback } from "./writing";

// BRIEF-001 · ADR-0010: 사람 수정 요청 → 편집장 해석 → 사람 확인(보정·다시 해석) → 수정 루프
test("BRIEF-001: 수정 해석을 확인·보정한 뒤에만 수정 착수", async ({ page }, testInfo) => {
  await page.goto("/write/#new");
  await page
    .getByLabel("글감과 원하는 결과")
    .fill(`해석 확인 ${testInfo.project.name} ${Date.now()}`);
  await page.getByRole("button", { name: "초안 만들기", exact: true }).click();
  const first = await ready(page);

  await writeFeedback(page, "너무 길어");
  await clickAction(page, "수정 요청", "feedback");

  // 해석만 나오고 멈춤: 승인 전 수정 루프 없음
  const approve = page.locator("#brief-approve");
  await expect(approve).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole("status")).toHaveText("수정 해석 확인 대기");
  await expect(page.getByLabel("의도")).toHaveValue("사용자가 요청한 수정 위치");
  await expect(page.getByLabel("어디부터 고칠까요")).toHaveValue("draft");
  await expect(page.locator(".brief-assumptions")).toContainText("문장 수준 수정");
  const waiting = await loadRun(page);
  expect(waiting).toMatchObject({ status: "awaiting_brief", canApproveBrief: true });
  expect(waiting.textRevision).toBe(first.revision);
  await checkAccessibility(page, testInfo, "brief-approval");

  // 다시 해석: 보정 의견을 붙여 해석만 다시 받음
  await expect(page.locator("#brief-revise")).toBeDisabled();
  await page.getByLabel("해석이 크게 다르면 다시 해석 요청").fill("구성은 그대로 두고");
  const revised = await clickAction(page, "다시 해석", "revise_brief");
  expect(revised.command).toMatchObject({ feedback: "구성은 그대로 두고" });
  await expect(page.getByLabel("의도")).toHaveValue("보정 의견을 반영한 수정 의도", {
    timeout: 45000,
  });

  // 보정 승인: 사람이 고친 항목만 전달 · 버튼 문구로 변경 여부 표시
  await page.getByLabel("어디부터 고칠까요").selectOption("outline");
  await page.getByLabel("살릴 것 (한 줄에 하나)").fill("쇼핑몰 예시\n연표");
  const approved = await clickAction(page, "고친 해석으로 진행", "approve_brief");
  expect(approved.command).toMatchObject({
    edit: { target: "outline", preserve: ["쇼핑몰 예시", "연표"] },
  });

  const done = await ready(page);
  expect(done.brief).toMatchObject({ target: "outline", approvedBy: "user" });
  await expect(page.locator("#edit-memo")).toContainText("확인한 해석으로 수정했습니다.");
  await expect(page.locator("#edit-memo")).toContainText("연표");
});
