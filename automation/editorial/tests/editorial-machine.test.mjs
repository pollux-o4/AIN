import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DIRECTION } from "../../contracts/writing-modes.mjs";
import * as machine from "../domain/index.mjs";

const { STAGES, transition, nextAction, flowIssue } = machine;

const outputs = {
  diagnose: {
    purpose: "経験と判断の共有",
    audience: "同じ課題の開発者",
    sectionModes: ["experience", "explanation"],
    preserveVoice: "一人称の迷いを保持",
    strategy: "経験→判断→結果; 分類表を強制しない",
  },
  topic: { problem: "接続障害", scope: "原因の切り分け" },
  audience: { reader: "運用担当", intent: "復旧したい" },
  value: { outcome: "判断を再現", preserve: ["失敗条件"] },
  research: { evidence: [], uncertainties: ["ログ未確認"] },
  outline: { sections: ["体験", "判断", "結果"], rationale: "時間順で因果を説明" },
  draft: { text: "実体験の本文。", changeSummary: "因果関係を補足" },
  review: { findings: ["出典未確認を表示"], preservationCheck: "条件・語り口を保持" },
};
let id = 0;
function event(state, type, data = {}) {
  return {
    id: `e${++id}`,
    actor: ["complete", "route", "fail"].includes(type) ? "adapter" : "user",
    type,
    expectedVersion: state?.version,
    ...data,
  };
}
function start(source = "原文") {
  return transition(null, event(null, "start", { articleId: "article", source })).state;
}
function complete(state) {
  return transition(
    state,
    event(state, "complete", {
      stage: state.stage,
      revision: state.revision,
      output: outputs[state.stage],
    }),
  ).state;
}
function finish(state, visited = []) {
  while (state.status === "waiting_ai") {
    visited.push(state.stage);
    state = complete(state);
  }
  return state;
}
test("start validates direction, fills defaults and preserves the user's choice across revisions", () => {
  assert.deepEqual(start().direction, DEFAULT_DIRECTION);
  const direction = { mode: "argue", readerLevel: "expert" };
  let state = transition(
    null,
    event(null, "start", { articleId: "direction", idea: "주장", direction }),
  ).state;
  assert.deepEqual(state.direction, direction);
  assert.notEqual(state.direction, direction);
  assert.equal(flowIssue(state), null);
  state = finish(state);
  state = transition(
    state,
    event(state, "feedback", { reviewedRevision: 1, feedback: "근거 보강" }),
  ).state;
  state = transition(
    state,
    event(state, "route", { revision: 2, target: "diagnose", reason: "진단부터 수정" }),
  ).state;
  assert.deepEqual(finish(state).direction, direction);
  assert.deepEqual(
    transition(
      null,
      event(null, "start", { articleId: "partial", idea: "글감", direction: { mode: "narrate" } }),
    ).state.direction,
    { mode: "narrate", readerLevel: "auto" },
  );
});

test("invalid directions fail start and state validation", () => {
  for (const direction of [null, [], "auto", { mode: "unknown" }, { readerLevel: "advanced" }]) {
    assert.throws(() =>
      transition(null, event(null, "start", { articleId: "invalid", idea: "글감", direction })),
    );
    const state = { ...start(), direction };
    const before = structuredClone(state);
    assert.match(flowIssue(state), /direction/i);
    assert.throws(() => complete(state), /direction/i);
    assert.deepEqual(state, before);
  }
});

test("stored states without direction still load and transition without migration", () => {
  const state = start();
  delete state.direction;
  const before = structuredClone(state);
  assert.equal(flowIssue(state), null);
  assert.equal(nextAction(state).type, "request_ai");
  assert.equal(finish(state).status, "awaiting_user");
  assert.deepEqual(state, before);
});

test("mixed-purpose article reaches user review without forcing explanation template or approval", () => {
  const visited = [];
  const state = finish(start(), visited);
  assert.deepEqual(visited, STAGES);
  assert.equal(flowIssue(state), null);
  assert.equal(state.status, "awaiting_user");
  assert.equal(state.approval, null);
  assert.deepEqual(state.artifacts.diagnose.output.sectionModes, ["experience", "explanation"]);
  assert.equal(state.source, "原文");
  assert.equal(Object.keys(state.artifacts).length, STAGES.length);
});
test("user-controlled loop exceeds three rounds; invalidates downstream work and preserves history", () => {
  let state = finish(start());
  for (let i = 0; i < 5; i++) {
    state = transition(
      state,
      event(state, "feedback", { reviewedRevision: state.revision, feedback: "構成を直したい" }),
    ).state;
    assert.equal(state.status, "waiting_route");
    assert.equal(state.approval, null);
    state = transition(
      state,
      event(state, "route", {
        revision: state.revision,
        target: "outline",
        reason: "情報順序の問題",
      }),
    ).state;
    assert.equal(state.artifacts.draft, undefined);
    assert.ok(state.artifacts.research);
    state = finish(state);
    assert.equal(state.status, "awaiting_user");
  }
  assert.equal(state.revision, 6);
  assert.equal(state.history.length, 5);
  assert.ok(state.history[0].artifacts.draft);
});
test("AI cannot approve, route to publication, or silently choose unknown stage", () => {
  const state = finish(start());
  assert.throws(
    () =>
      transition(
        state,
        event(state, "satisfy", { actor: "adapter", reviewedRevision: state.revision }),
      ),
    /actor/,
  );
  const routed = transition(
    state,
    event(state, "feedback", { reviewedRevision: state.revision, feedback: "改善" }),
  ).state;
  for (const target of ["publish", "unknown", "__proto__"])
    assert.throws(
      () =>
        transition(
          routed,
          event(routed, "route", { revision: routed.revision, target, reason: "提案" }),
        ),
      /Route/,
    );
  assert.equal(routed.status, "waiting_route");
});
test("satisfaction and publication authorization are separate; feedback revokes both", () => {
  let state = finish(start());
  assert.throws(
    () => transition(state, event(state, "authorize_publication", { reviewedRevision: 1 })),
    /Separate/,
  );
  state = transition(state, event(state, "satisfy", { reviewedRevision: 1 })).state;
  assert.equal(state.status, "satisfied");
  const result = transition(state, event(state, "authorize_publication", { reviewedRevision: 1 }));
  assert.equal(result.action.executed, false);
  assert.equal(result.state.status, "publication_ready");
  state = transition(
    result.state,
    event(result.state, "feedback", { reviewedRevision: 1, feedback: "もう一度修正" }),
  ).state;
  assert.equal(state.approval, null);
  assert.equal(state.satisfiedRevision, null);
});
test("stale replies and duplicate events cannot advance state twice", () => {
  let state = start();
  const e = event(state, "complete", { stage: "diagnose", revision: 1, output: outputs.diagnose });
  state = transition(state, e).state;
  assert.equal(transition(state, e).duplicate, true);
  assert.equal(transition(state, e).state.version, state.version);
  assert.throws(() => transition(state, { ...e, output: {} }), /reused/);
  assert.throws(
    () =>
      transition(
        state,
        event(state, "complete", { stage: "audience", revision: 1, output: outputs.audience }),
      ),
    /Unexpected/,
  );
  assert.throws(() => transition(state, event(state, "pause", { expectedVersion: 1 })), /Stale/);
});
test("fail/retry and pause/resume preserve pending work; incomplete AI output rejected", () => {
  let state = start();
  assert.throws(
    () =>
      transition(state, event(state, "complete", { stage: "diagnose", revision: 1, output: {} })),
    /purpose|Invalid input/,
  );
  state = transition(
    state,
    event(state, "fail", { stage: "diagnose", revision: 1, error: "timeout" }),
  ).state;
  assert.equal(state.status, "failed");
  state = transition(state, event(state, "retry")).state;
  assert.equal(state.status, "waiting_ai");
  state = transition(state, event(state, "pause")).state;
  assert.equal(state.status, "paused");
  state = transition(state, event(state, "resume")).state;
  assert.equal(state.status, "waiting_ai");
  assert.equal(state.stage, "diagnose");
});
test("every allowed AI route returns to user review and preserves source", () => {
  for (const target of STAGES) {
    let state = finish(start("大切な原文"));
    state = transition(
      state,
      event(state, "feedback", { reviewedRevision: 1, feedback: "再検討" }),
    ).state;
    state = transition(
      state,
      event(state, "route", { revision: 2, target, reason: "ユーザーの意図" }),
    ).state;
    state = finish(state);
    assert.equal(state.status, "awaiting_user");
    assert.equal(state.source, "大切な原文");
  }
});

test("new requests reject every plan except exact full STAGES", () => {
  for (const plan of [
    ["diagnose", "draft", "review"],
    ["diagnose", "review"],
    ["diagnose", "draft", "draft", "review"],
    ["draft", "diagnose", "review"],
    STAGES.slice(0, -1),
    [...STAGES, "review"],
    null,
    "all",
  ])
    assert.throws(
      () => transition(null, event(null, "start", { articleId: "bad", idea: "test", plan })),
      /Invalid editorial plan/,
    );
  assert.deepEqual(start().plan, STAGES);
  assert.deepEqual(
    transition(null, event(null, "start", { articleId: "full", idea: "test", plan: STAGES })).state
      .plan,
    STAGES,
  );
});

function legacy() {
  const startEvent = event(null, "start", {
    articleId: "legacy",
    source: " 원문\r\n보존 😀 ",
    idea: " 기존 요구\n",
    plan: ["diagnose", "draft", "review"],
  });
  const state = {
    schemaVersion: 1,
    articleId: startEvent.articleId,
    source: startEvent.source,
    idea: startEvent.idea,
    plan: startEvent.plan,
    version: 4,
    revision: 1,
    stage: "review",
    status: "awaiting_user",
    artifacts: {},
    history: [{ revision: 0, artifacts: { draft: { output: { text: "이전 초고\r\n" } } } }],
    seen: { [startEvent.id]: JSON.stringify(startEvent) },
    approval: null,
    satisfiedRevision: null,
  };
  for (const stage of state.plan)
    state.artifacts[stage] = { revision: 1, output: structuredClone(outputs[stage]) };
  return { state, startEvent };
}

function assertBlocked(state) {
  const original = structuredClone(state);
  const reason = flowIssue(state);
  assert.equal(typeof reason, "string");
  assert.ok(reason.length > 0);
  assert.deepEqual(nextAction(state), {
    type: "requirements_required",
    revision: state.revision,
    reason,
  });
  const attempts = [
    ["complete", { stage: state.stage, revision: state.revision, output: outputs[state.stage] }],
    ["route", { target: "review", revision: state.revision, reason: "bypass" }],
    ["feedback", { feedback: "bypass", reviewedRevision: state.revision }],
    ["satisfy", { reviewedRevision: state.revision }],
    ["authorize_publication", { reviewedRevision: state.revision }],
    ["resume", {}],
    ["retry", {}],
  ];
  for (const [type, data] of attempts) {
    assert.throws(() => transition(state, event(state, type, data)), /requirements|contract/i);
    assert.deepEqual(state, original);
  }
}

test("fresh schemaVersion 1 state is complete enough for diagnosis; implicit full legacy plan works", () => {
  const state = start();
  assert.equal(flowIssue(state), null);
  assert.equal(nextAction(state).type, "request_ai");
  delete state.plan;
  assert.equal(flowIssue(state), null);
  assert.equal(complete(state).stage, "topic");
  assert.throws(() => transition(start(), event(start(), "complete_requirements")), /incomplete/i);
});

test("compact and corrupt states never create AI work or accept bypass actions", () => {
  assertBlocked(legacy().state);
  for (const stage of STAGES.slice(1)) {
    const state = start();
    state.stage = stage;
    assertBlocked(state);
  }
  for (const status of [
    "waiting_ai",
    "awaiting_user",
    "satisfied",
    "publication_ready",
    "paused",
    "failed",
  ]) {
    for (const damage of ["missing", "wrong_revision", "invalid"]) {
      const state = finish(start());
      state.status = status;
      if (["paused", "failed"].includes(status)) state.resumeStatus = "waiting_ai";
      if (damage === "missing") delete state.artifacts.topic;
      if (damage === "wrong_revision") state.artifacts.topic.revision = 0;
      if (damage === "invalid") state.artifacts.topic.output.scope = " ";
      assertBlocked(state);
    }
  }
});

test("explicit requirements completion preserves prior snapshots and source bytes, resets the full flow", () => {
  const { state } = legacy();
  state.feedback = "old feedback";
  state.routeReason = "old route";
  state.resumeStatus = "waiting_route";
  state.error = "old error";
  state.approval = { revision: 1, eventId: "old approval" };
  state.satisfiedRevision = 1;
  const prior = structuredClone(state);
  const upgrade = event(state, "complete_requirements");
  const result = transition(state, upgrade);
  const upgraded = result.state;
  assert.deepEqual(state, prior);
  assert.equal(upgraded.schemaVersion, 1);
  assert.equal(upgraded.revision, 2);
  assert.equal(upgraded.version, prior.version + 1);
  assert.equal(upgraded.source, prior.source);
  assert.equal(upgraded.idea, prior.idea);
  assert.deepEqual(upgraded.history.slice(0, -1), prior.history);
  assert.deepEqual(upgraded.history.at(-1).artifacts, prior.artifacts);
  assert.deepEqual(upgraded.history.at(-1).plan, prior.plan);
  assert.equal(upgraded.history.at(-1).revision, 1);
  assert.equal(upgraded.history.at(-1).feedback, prior.feedback);
  assert.deepEqual(upgraded.plan, STAGES);
  assert.deepEqual(upgraded.artifacts, {});
  for (const key of ["feedback", "routeReason", "resumeStatus", "error"])
    assert.equal(upgraded[key], undefined);
  assert.equal(upgraded.approval, null);
  assert.equal(upgraded.satisfiedRevision, null);
  assert.equal(result.action.type, "request_ai");
  assert.equal(upgraded.stage, "diagnose");
  const visited = [];
  const finished = finish(upgraded, visited);
  assert.deepEqual(visited, STAGES);
  assert.equal(flowIssue(finished), null);
  assert.deepEqual(finished.history, upgraded.history);
  assert.equal(transition(finished, upgrade).duplicate, true);
  assert.throws(() => transition(state, { ...upgrade, actor: "adapter" }), /actor/);
  assert.throws(() => transition(state, { ...upgrade, expectedVersion: 0 }), /Stale/);
});

test("duplicate legacy events replay before contract checks and stale new events never mutate", () => {
  const { state, startEvent } = legacy();
  const result = transition(state, startEvent);
  assert.equal(result.duplicate, true);
  assert.deepEqual(result.state, state);
  assert.equal(result.action.type, "requirements_required");
  assert.throws(() => transition(state, { ...startEvent, idea: "changed" }), /reused/);
  assert.throws(
    () => transition(state, event(state, "complete_requirements", { expectedVersion: 1 })),
    /Stale/,
  );
});

test("feedback routes validate and promote every retained upstream artifact before completing the suffix", () => {
  for (const target of STAGES) {
    const prior = finish(start());
    const routed = transition(
      prior,
      event(prior, "feedback", { reviewedRevision: 1, feedback: "수정" }),
    ).state;
    assert.equal(flowIssue(routed), null);
    const state = transition(
      routed,
      event(routed, "route", { revision: 2, target, reason: "순서" }),
    ).state;
    const prefix = STAGES.slice(0, STAGES.indexOf(target));
    assert.deepEqual(Object.keys(state.artifacts), prefix);
    for (const stage of prefix) {
      assert.equal(state.artifacts[stage].revision, 2);
      assert.equal(state.artifacts[stage].reusedFromRevision, 1);
      assert.deepEqual(state.artifacts[stage].output, prior.artifacts[stage].output);
    }
    const visited = [];
    const finished = finish(state, visited);
    assert.deepEqual(visited, STAGES.slice(STAGES.indexOf(target)));
    assert.deepEqual(Object.keys(finished.artifacts), STAGES);
    assert.ok(Object.values(finished.artifacts).every((artifact) => artifact.revision === 2));
    assert.equal(flowIssue(finished), null);
    assert.deepEqual(finished.history[0].artifacts, prior.artifacts);
    for (const damaged of ["missing", "wrong_revision", "invalid"]) {
      const corrupt = structuredClone(routed);
      if (damaged === "missing") delete corrupt.artifacts.diagnose;
      if (damaged === "wrong_revision") corrupt.artifacts.diagnose.revision = 0;
      if (damaged === "invalid") corrupt.artifacts.diagnose.output.sectionModes = [null];
      assertBlocked(corrupt);
    }
  }
});

test("structural array contracts reject blank, nontext and malformed evidence without claiming verification", () => {
  const invalid = [
    ["diagnose", { ...outputs.diagnose, sectionModes: [""] }],
    ["value", { ...outputs.value, preserve: [null] }],
    ["research", { evidence: [], uncertainties: [" "] }],
    ["research", { evidence: ["source"], uncertainties: [] }],
    ["research", { evidence: [{ claim: "claim" }], uncertainties: [] }],
    ["research", { evidence: [{ claim: "", url: "source" }], uncertainties: [] }],
    ["research", { evidence: [{ claim: "claim", url: 42 }], uncertainties: [] }],
    ["outline", { ...outputs.outline, sections: [{}] }],
    ["review", { ...outputs.review, findings: [false] }],
  ];
  for (const [stage, output] of invalid) {
    let state = start();
    while (state.stage !== stage) state = complete(state);
    const before = structuredClone(state);
    assert.throws(() =>
      transition(state, event(state, "complete", { stage, revision: 1, output })),
    );
    assert.deepEqual(state, before);
  }
  let state = start();
  while (state.stage !== "research") state = complete(state);
  const output = {
    evidence: [{ claim: "확인 전 주장", url: "unverified", locator: { page: 3 } }],
    uncertainties: [],
  };
  state = transition(
    state,
    event(state, "complete", { stage: "research", revision: 1, output }),
  ).state;
  assert.deepEqual(state.artifacts.research.output, output);
});

test("flowIssue returns reasons for malformed envelopes and pending-route history corruption", () => {
  const state = start();
  const malformed = [
    null,
    undefined,
    false,
    1,
    "state",
    [],
    {},
    ...[
      { schemaVersion: 2 },
      { version: 0 },
      { revision: -1 },
      { revision: 1.5 },
      { articleId: null },
      { source: null },
      { idea: null },
      { history: null },
      { seen: null },
      { plan: null },
      { stage: "publish" },
      { status: "unknown" },
      { artifacts: null },
      { status: "paused", resumeStatus: "paused" },
      { status: "failed", resumeStatus: "awaiting_user" },
    ].map((patch) => ({ ...state, ...patch })),
  ];
  for (const value of malformed) {
    assert.equal(typeof flowIssue(value), "string");
    assert.equal(nextAction(value).type, "requirements_required");
  }
  assert.equal(
    typeof flowIssue({
      get schemaVersion() {
        throw new Error("malformed");
      },
    }),
    "string",
  );
  const ready = finish(start());
  const routed = transition(
    ready,
    event(ready, "feedback", { reviewedRevision: 1, feedback: "수정" }),
  ).state;
  for (const damage of [
    "missing_history",
    "wrong_history_revision",
    "missing_history_artifact",
    "invalid_history_artifact",
    "wrong_current_revision",
    "changed_current_output",
  ]) {
    const corrupt = structuredClone(routed);
    if (damage === "missing_history") corrupt.history = [];
    if (damage === "wrong_history_revision") corrupt.history.at(-1).revision = 2;
    if (damage === "missing_history_artifact") delete corrupt.history.at(-1).artifacts.topic;
    if (damage === "invalid_history_artifact") corrupt.history.at(-1).artifacts.topic.output = {};
    if (damage === "wrong_current_revision") corrupt.artifacts.topic.revision = 2;
    if (damage === "changed_current_output") corrupt.artifacts.topic.output.scope = "changed";
    assertBlocked(corrupt);
  }
});

test("pending feedback route survives explicit pause/resume and fail/retry with previous revision intact", () => {
  let state = finish(start());
  state = transition(
    state,
    event(state, "feedback", { reviewedRevision: 1, feedback: "다시 진단" }),
  ).state;
  const artifacts = structuredClone(state.artifacts);
  state = transition(state, event(state, "pause")).state;
  assert.equal(flowIssue(state), null);
  assert.equal(nextAction(state).type, "wait_for_user");
  state = transition(state, event(state, "resume")).state;
  assert.equal(nextAction(state).type, "request_route");
  state = transition(
    state,
    event(state, "fail", { revision: 2, stage: "review", error: "timeout" }),
  ).state;
  assert.equal(flowIssue(state), null);
  assert.equal(nextAction(state).type, "wait_for_user");
  state = transition(state, event(state, "retry")).state;
  assert.equal(nextAction(state).type, "request_route");
  assert.deepEqual(state.artifacts, artifacts);
  state = transition(
    state,
    event(state, "route", { revision: 2, target: "diagnose", reason: "새 진단" }),
  ).state;
  const visited = [];
  state = finish(state, visited);
  assert.deepEqual(visited, STAGES);
  assert.equal(flowIssue(state), null);
});
