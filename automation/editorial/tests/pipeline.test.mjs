import assert from "node:assert/strict";
import test from "node:test";
import { STAGES, transition } from "../domain/index.mjs";
import { runMonitor, runPipeline } from "../monitor.mjs";

const diagnosis = {
  purpose: "설명",
  audience: "입문자",
  sectionModes: ["설명"],
  preserveVoice: "의미 유지",
  strategy: "사례 설명",
};
const fresh = () =>
  transition(null, {
    id: "start",
    actor: "user",
    type: "start",
    articleId: "article",
    idea: "주문 설명",
  }).state;
const completeDiagnosis = () => {
  const state = fresh();
  return transition(state, {
    id: "diagnosis",
    actor: "adapter",
    type: "complete",
    expectedVersion: state.version,
    revision: 1,
    stage: "diagnose",
    output: diagnosis,
  }).state;
};

test("all eight stages show completion and observed times on a realistic sequence", () => {
  const state = completeDiagnosis();
  const steps = runPipeline({
    state,
    events: [
      { revision: 1, stage: "diagnose", kind: "ai_requested", at: 1000 },
      { revision: 1, stage: "diagnose", kind: "ai_completed", at: 4000 },
      { revision: 1, stage: "topic", kind: "ai_requested", at: 5000 },
      { revision: 0, stage: "topic", kind: "ai_requested", at: 1 },
    ],
  });
  assert.deepEqual(
    steps.map((s) => s.stage),
    STAGES,
  );
  assert.deepEqual(
    steps.map((s) => [s.status, s.startedAt, s.completedAt]),
    [
      ["done", 1000, 4000],
      ["active", 5000, null],
      ...STAGES.slice(2).map(() => ["pending", null, null]),
    ],
  );
});

test("paused and failed markers identify the actual pending stage", () => {
  const state = completeDiagnosis();
  for (const [type, actor, status] of [
    ["pause", "user", "paused"],
    ["fail", "adapter", "failed"],
  ]) {
    const next = transition(state, {
      id: type,
      type,
      actor,
      expectedVersion: state.version,
      stage: state.stage,
      revision: state.revision,
      error: "실패 확인",
    }).state;
    assert.equal(runPipeline({ state: next })[1].status, status);
  }
});

test("legacy omissions remain pending and wrong-revision or malformed artifacts never show done", () => {
  const state = completeDiagnosis();
  state.plan = ["diagnose", "draft", "review"];
  state.stage = "review";
  state.artifacts.draft = { revision: 0, output: { text: "과거", changeSummary: "과거" } };
  state.artifacts.review = { revision: 1, output: {} };
  const before = structuredClone(state);
  const steps = runPipeline({ state });
  assert.deepEqual(
    steps.map((s) => s.stage),
    STAGES,
  );
  assert.equal(steps[0].status, "done");
  assert.ok(steps.slice(1).every((s) => s.status === "pending"));
  assert.equal(runMonitor({ state }, 1000).kind, "blocked");
  assert.equal(runMonitor({ state }, 1000).canResume, false);
  assert.deepEqual(state, before);
});

test("FLOW-001: structurally valid but empty stage contents are not marked complete", () => {
  for (const output of [
    { ...diagnosis, strategy: " " },
    { ...diagnosis, sectionModes: [] },
  ]) {
    const state = completeDiagnosis();
    state.artifacts.diagnose.output = output;
    const steps = runPipeline({ state });
    assert.equal(steps[0].status, "pending");
    assert.ok(steps.every((step) => step.status !== "active"));
  }
});
