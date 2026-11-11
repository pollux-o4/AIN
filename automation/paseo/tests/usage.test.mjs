import assert from "node:assert/strict";
import test from "node:test";
import { usageSummary } from "../usage.mjs";

test("usage: 단계별·전체 합산, 경로 판단 구분, 미보고 호출은 추정 없이 별도 계수", () => {
  const usage = (inputTokens, outputTokens) => ({
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
  });
  const summary = usageSummary([
    { action: { type: "request_stage", stage: "draft" }, usage: usage(100, 20) },
    { action: { type: "request_stage", stage: "draft" }, usage: usage(50, 5) },
    { action: { type: "request_route" }, usage: usage(10, 1) },
    { action: { type: "request_stage", stage: "review" }, usage: null },
  ]);
  assert.deepEqual(summary.stages.draft, {
    inputTokens: 150,
    cachedInputTokens: 0,
    outputTokens: 25,
    calls: 2,
  });
  assert.equal(summary.stages.route.calls, 1);
  assert.equal(summary.stages.review, undefined);
  assert.deepEqual(summary.total, {
    inputTokens: 160,
    cachedInputTokens: 0,
    outputTokens: 26,
    calls: 3,
    unreported: 1,
  });
});
