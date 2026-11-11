import assert from "node:assert/strict";
import test from "node:test";
import { executionHistory } from "../service/history.mjs";

const event = (kind, revision, jobId, stage = "topic") => ({
  kind,
  revision,
  jobId,
  stage,
  at: 10,
  label: kind,
  executionId: "42",
});
test("HISTORY-001: stored attempts, prior revisions, inputs and routing survive reopen without AI execution", async () => {
  const events = [
    event("ai_requested", 1, "one"),
    event("ai_completed", 1, "one"),
    event("ai_completed", 2, "route", "route"),
    { ...event("failed", 2), reason: "한도 초과" },
  ];
  const run = { events, state: { revision: 2 } };
  const reads = [];
  const service = {
    store: { get: () => structuredClone(run) },
    jobs: {
      async describe(id) {
        reads.push(id);
        return {
          model: "fixture/model",
          inputs: { source: true, feedback: id === "route", stages: ["diagnose"], baseline: false },
          output: id === "one" ? { problem: "이전 회차의 실제 문제", scope: "주문" } : null,
          target: id === "route" ? "draft" : null,
          reason: id === "route" ? "표현 수정" : null,
        };
      },
    },
  };
  const history = await executionHistory(service, "run");
  assert.deepEqual(reads.sort(), ["one", "route"]);
  assert.equal(history.records[0].output, null);
  assert.deepEqual(history.records[1].output, { problem: "이전 회차의 실제 문제", scope: "주문" });
  assert.deepEqual(history.records[1].inputs, ["글감", "참고 자료", "진단 결과"]);
  assert.equal(history.records[2].target, "초고 작성");
  assert.equal(history.records[2].reason, "표현 수정");
  assert.equal(history.records[3].reason, "한도 초과");
  assert.deepEqual(await executionHistory(service, "run"), history);
  assert.deepEqual(run.events, events);
});
test("HISTORY-001: missing job files are explicit and only retained results are shown", async () => {
  const run = {
    events: [event("ai_completed", 1, "missing"), event("ai_requested", 2, "missing2")],
    state: {
      revision: 2,
      history: [{ revision: 1, artifacts: { topic: { output: { problem: "보존 결과" } } } }],
    },
  };
  const service = {
    store: { get: () => run },
    jobs: {
      describe: async () => {
        throw Error("missing");
      },
    },
  };
  const { records } = await executionHistory(service, "run");
  assert.equal(records[0].resultSource, "artifact");
  assert.equal(records[0].unavailable, true);
  assert.deepEqual(records[0].output, { problem: "보존 결과" });
  assert.equal(records[1].output, null);
  assert.equal(records[1].resultSource, "none");
  assert.deepEqual(await executionHistory({ store: { get: () => ({ state: {} }) } }, "legacy"), {
    records: [],
    journey: [],
  });
});
