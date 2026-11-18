import assert from "node:assert/strict";
import test from "node:test";
import { renderUsage } from "../../cli/usage-view.mjs";
import { usageReport } from "../service/usage.mjs";

const ev = (at, kind, jobId, extra = {}) => ({
  at,
  kind,
  jobId,
  revision: 1,
  stage: "draft",
  ...extra,
});

test("사용량은 회차→단계→시도로 모으고, 다시 요청된 시도는 거부·큰 시간부터 먼저 볼 곳", () => {
  const section = (index) => ({ index, total: 2 });
  const jobs = new Map([
    ["a", { usage: { inputTokens: 100, outputTokens: 50 }, section: section(0), chars: 900 }],
    ["b", { usage: { inputTokens: 100, outputTokens: 50 }, section: section(0), chars: 500 }],
    ["c", { usage: null, section: section(1), chars: null }],
  ]);
  const events = [
    ev(0, "ai_requested", "a"),
    ev(60_000, "ai_completed", "a"),
    ev(60_000, "ai_requested", "b"),
    ev(90_000, "ai_completed", "b"),
    ev(90_000, "ai_requested", "c"),
    ev(600_000, "failed", undefined),
  ];
  const usage = usageReport(events, jobs, 700_000);
  assert.equal(usage.calls, 3);
  assert.equal(usage.wasted, 2, "거부 1 + 실패 1");
  assert.equal(usage.tokens, 300, "기록 없는 토큰은 0으로 섞지 않음");
  const attempts = usage.revisions[0].stages[0].attempts.map((a) => a.outcome);
  assert.deepEqual(attempts, ["rejected", "accepted", "failed"]);
  assert.equal(usage.hotspots[0].ms, 510_000);
  assert.match(renderUsage(usage), /먼저 볼 곳[\s\S]*8분 30초 · 토큰 기록 없음 · 실패/);
});
