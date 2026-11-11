import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { STAGES, transition } from "../../editorial/domain/index.mjs";
import { EditorialService, EditorialStore } from "../../editorial/index.mjs";
import { startIsolatedN8n } from "../../n8n/testing/runtime.mjs";
import { makeServer } from "../../runtime/server.mjs";

// FLOW-001/FLOW-002: real service/store and n8n transport; Jobs is a deterministic fixture.
const base = resolve(".local/paseo-flow-tests");
await mkdir(base, { recursive: true });
const root = await mkdtemp(join(base, "run-"));
const calls = [];
const records = new Map();
let forceFailure = false;
const outputs = {
  diagnose: {
    purpose: "fixture",
    audience: "개발자",
    sectionModes: ["explanation"],
    preserveVoice: "의미",
    strategy: "관계 설명",
  },
  topic: { problem: "fixture", scope: "테스트" },
  audience: { reader: "개발자", intent: "이해" },
  value: { outcome: "이해", preserve: ["조건"] },
  research: { evidence: [], uncertainties: ["fixture"] },
  outline: { sections: ["개념", "역할"], rationale: "관계" },
  review: { findings: [], preservationCheck: "조건 보존" },
};
const jobs = {
  async create({ state, ai }) {
    const stage = state.status === "waiting_route" ? "route" : state.stage;
    calls.push(stage);
    const id = String(calls.length).padStart(64, "0");
    const event = {
      id: `flow-result-${calls.length}`,
      actor: "adapter",
      expectedVersion: state.version,
      revision: state.revision,
      ...(stage === "route"
        ? { type: "route", target: "outline", reason: "사용자 피드백의 구조 수정" }
        : {
            type: "complete",
            stage,
            output:
              stage === "draft"
                ? { text: `AI fixture 초안 r${state.revision}`, changeSummary: "테스트 수정" }
                : outputs[stage],
          }),
    };
    transition(state, event);
    const job = {
      id,
      createdAt: new Date().toISOString(),
      state,
      ai,
      providerModel: "fixture/model",
      status: "running",
      event,
      forceFailure,
      polls: 0,
    };
    records.set(id, job);
    return job;
  },
  async poll(id) {
    const job = records.get(id);
    job.polls += 1;
    if (job.forceFailure)
      return { ...job, status: "failed", event: null, failureKind: "usage_limit" };
    // At least one running response must be carried through n8n's Wait loop.
    return { ...job, status: job.polls === 1 ? "running" : "completed" };
  },
};
const token = "fixture-only-not-production-secret";
const store = new EditorialStore(join(root, "state.sqlite"));
let runtime;
const service = new EditorialService({
  store,
  jobs,
  ai: { provider: "fixture", model: "fixture-model", enabled: true, maxDurationMs: 120000 },
  dispatch: (id) => runtime.dispatch(id),
});
const server = makeServer({ editorial: service, token, n8nUrl: "http://127.0.0.1:5708" });
async function waitFor(id, status) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const run = store.get(id);
    if (run.state.status === status) return run;
    assert.equal(run.issue, null, "Unexpected service issue while awaiting transport");
    assert.notEqual(run.state.status, "failed", "Run failed before expected status");
    await delay(100);
  }
  throw new Error("Timed out waiting for fixture run");
}
async function feedback(id, operationId) {
  return service.action(id, {
    operationId,
    expectedVersion: store.get(id).state.version,
    type: "feedback",
    feedback: "정보 순서를 바꿔줘",
  });
}
try {
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const bridgeUrl = `http://127.0.0.1:${server.address().port}`;
  const n8nRoot = join(root, "n8n");
  await mkdir(n8nRoot, { mode: 0o700 });
  runtime = await startIsolatedN8n({ root: n8nRoot, port: 5708, bridgeUrl, token });
  const view = await service.create({ requestId: "flow-all-eight", idea: "루프 연결 검증" });
  assert.match(view.id, /^[a-f0-9-]{36}$/);
  const id = view.id;
  let run = await waitFor(id, "awaiting_user");
  assert.deepEqual(calls, STAGES);
  assert.equal(run.callsUsed, STAGES.length);
  assert.equal(run.state.revision, 1);
  assert.deepEqual(
    service.get(id).artifacts.map((artifact) => artifact.stage),
    STAGES,
  );
  assert.equal(service.download(id).text, "AI fixture 초안 r1\n");
  assert.equal(run.state.satisfiedRevision, null);
  assert.equal(run.state.approval, null);
  assert.ok(run.worker.executionId);
  assert.ok([...records.values()].every((job) => job.polls === 2));

  const action = {
    operationId: "flow-feedback-2",
    expectedVersion: run.state.version,
    type: "feedback",
    feedback: "정보 순서를 바꿔줘",
  };
  await service.action(id, action);
  await service.action(id, action);
  run = await waitFor(id, "awaiting_user");
  assert.equal(run.state.revision, 2);
  assert.equal(run.state.history.length, 1);
  assert.equal(service.download(id).text, "AI fixture 초안 r2\n");
  assert.equal(service.download(id, 1).text, "AI fixture 초안 r1\n");
  assert.deepEqual(calls, [...STAGES, "route", "outline", "draft", "review"]);
  assert.equal(run.state.approval, null);
  assert.equal(run.state.satisfiedRevision, null);

  forceFailure = true;
  await feedback(id, "flow-feedback-failure");
  run = await waitFor(id, "failed");
  assert.deepEqual(calls, [...STAGES, "route", "outline", "draft", "review", "route"]);
  assert.equal(run.pending, null);
  assert.match(run.issue, /사용 한도/);
  assert.equal(run.state.revision, 3);
  assert.equal(service.get(id).canFeedback, false);
  assert.equal(service.download(id, 2).text, "AI fixture 초안 r2\n");
  await assert.rejects(() => feedback(id, "flow-blocked-feedback"), { status: 409 });
  const count = calls.length;
  await delay(2500);
  assert.equal(calls.length, count, "Failure must wait for an explicit user retry");

  forceFailure = false;
  await service.action(id, {
    operationId: "flow-retry",
    expectedVersion: run.state.version,
    type: "resume",
  });
  run = await waitFor(id, "awaiting_user");
  assert.deepEqual(calls, [
    ...STAGES,
    "route",
    "outline",
    "draft",
    "review",
    "route",
    "route",
    "outline",
    "draft",
    "review",
  ]);
  assert.equal(run.state.revision, 3);
  assert.equal(service.download(id).text, "AI fixture 초안 r3\n");
  assert.equal(run.state.approval, null);
  assert.equal(run.state.satisfiedRevision, null);
  console.log(
    "FLOW-001/FLOW-002 verified: full8, feedback/download revisions, failure gate and explicit retry (fixture Jobs)",
  );
} finally {
  await runtime?.stop();
  await new Promise((done) => server.close(done));
  store.close();
}
