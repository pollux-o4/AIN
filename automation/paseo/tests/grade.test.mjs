// 검증: 실제 모델 결과 채점 · ADR-0013
import assert from "node:assert/strict";
import test from "node:test";
import { grade, summarize } from "../live/grade.mjs";

const good = {
  characters: 760,
  requirements: { length: { min: 600, max: 900 } },
  autoCorrections: 0,
  storyCards: 2,
  cardSections: 2,
  metrics: {
    missingHeadings: [],
    cardTransfer: {
      titleMatches: true,
      missingHooks: [],
      missingUnderlines: [],
      missingPrincipleLines: [],
      notInSummary: [],
    },
  },
  verdict: "pass",
  checks: 10,
  failedChecks: [],
};

test("필수 기준을 하나라도 어기면 불합격, 검토 점검표는 추세만 본다", () => {
  assert.equal(grade(good).passed, true);
  const soft = grade({ ...good, failedChecks: ["S9"] });
  assert.deepEqual([soft.passed, soft.results.checks], [true, false]);
  const cases = {
    length: { characters: 917 },
    first_pass: { autoCorrections: 1 },
    cards: { storyCards: 1 },
    transfer: {
      metrics: {
        ...good.metrics,
        cardTransfer: { ...good.metrics.cardTransfer, missingHooks: ["앞"] },
      },
    },
    headings: { metrics: { ...good.metrics, missingHeadings: ["앞"] } },
    verdict: { verdict: "revise" },
  };
  for (const [id, change] of Object.entries(cases)) {
    const graded = grade({ ...good, ...change });
    assert.deepEqual([graded.passed, graded.results[id]], [false, false], id);
  }
  // 따라 하기 글: 카드·대조 대상이 없고 분량 상한이 없어도 채점된다
  const procedure = {
    ...good,
    requirements: { length: { min: 600, max: null } },
    storyCards: 0,
    cardSections: 0,
    metrics: { ...good.metrics, cardTransfer: undefined },
  };
  assert.equal(grade(procedure).passed, true);
});

test("반복 실행 묶음: 실행 실패도 불합격으로 세고, 전부 통과해야 일관", () => {
  const run = (quality, calls) => ({ quality, calls, durationMs: 300000, outputTokens: 20000 });
  const steady = summarize([run(good, 10), run(good, 11), run(good, 10)]);
  assert.deepEqual([steady.passRate, steady.consistent], [1, true]);
  assert.deepEqual(steady.calls, { min: 10, median: 10, max: 11 });
  const shaky = summarize([
    run(good, 10),
    run({ ...good, autoCorrections: 1, failedChecks: ["S9"] }, 14),
    { failure: "Live verification failed (article)" },
  ]);
  assert.deepEqual([shaky.passRate, shaky.consistent, shaky.completed], [0.33, false, 2]);
  assert.equal(shaky.graders.first_pass, 0.33);
  assert.deepEqual(shaky.failedChecks, { S9: 1 });
  assert.equal(shaky.failures.length, 1);
});
