import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { FIGURE_PASSES } from "../../contracts/figure.mjs";
import { nextAction, STAGES, transition } from "../../editorial/domain/index.mjs";
import { EditorialService, EditorialStore } from "../../editorial/index.mjs";
import { startIsolatedN8n } from "../../n8n/testing/runtime.mjs";
import { scratchDir } from "../../runtime/scratch.mjs";
import { makeServer } from "../../runtime/server.mjs";

// FLOW-001/FLOW-002: real service/store and n8n transport; Jobs is a deterministic fixture.
const scratch = await scratchDir("paseo-flow");
const root = scratch.path;
const calls = [];
const records = new Map();
let forceFailure = false;
// FIGURE-001: 초안에 그대로 있는 앵커 문장
const FIGURE_ANCHOR = "AI fixture 초안";
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
    const action = nextAction(state);
    const figure = action.type === "request_figure";
    const stage = figure ? action.stage : state.status === "waiting_route" ? "route" : state.stage;
    calls.push(stage);
    const id = String(calls.length).padStart(64, "0");
    const event = {
      id: `flow-result-${calls.length}`,
      actor: "adapter",
      expectedVersion: state.version,
      revision: state.revision,
      ...(figure
        ? {
            type: "figure_result",
            stage,
            // 생성은 층마다 한 번씩 이어지고, 결과는 자기 층을 밝혀야 받아들여진다
            ...(action.pass ? { pass: action.pass } : {}),
            output:
              stage === "figure_plan"
                ? {
                    candidates: [
                      {
                        anchor: FIGURE_ANCHOR,
                        claim: "fixture 주장",
                        reason: "이유",
                        scene: "장면",
                      },
                    ],
                  }
                : stage === "figure_compose"
                  ? { world: "fixture 세계", designs: [{ id: "f1", scene: "장면" }] }
                  : { figures: [{ id: "f1", svg: "<svg><rect/></svg>", alt: "fixture 도식" }] },
          }
        : stage === "route"
          ? { type: "route", target: "outline", reason: "사용자 피드백의 구조 수정" }
          : {
              type: "complete",
              stage,
              output:
                stage === "draft"
                  ? { text: `# AI fixture 초안 r${state.revision}`, changeSummary: "테스트 수정" }
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
// 이 테스트는 여러 회차·실패·재개·시각자료가 n8n 전달 루프로 이어지는지를 본다(호출 30회 안팎)
// 운영 대기 간격(2초)의 준수는 test:n8n:runtime이 검증하므로 여기서는 줄여 쓴다 · TIME-001
const WAIT_SECONDS = 0.2;
// "더 진행하지 않음" 확인: 대기 간격을 여러 번 넘기는 시간
const QUIET_MS = WAIT_SECONDS * 1000 * 4;
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
// 사람 피드백은 해석 승인 후 진행 · ADR-0010
async function approveBrief(id) {
  const run = await waitFor(id, "awaiting_brief");
  await service.action(id, {
    operationId: `approve-${run.state.version}`,
    expectedVersion: run.state.version,
    type: "approve_brief",
  });
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
  runtime = await startIsolatedN8n({
    root: n8nRoot,
    port: 5708,
    bridgeUrl,
    token,
    waitSeconds: WAIT_SECONDS,
  });
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
  assert.equal(service.download(id).text, "# AI fixture 초안 r1\n");
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
  await approveBrief(id);
  run = await waitFor(id, "awaiting_user");
  assert.equal(run.state.revision, 2);
  assert.equal(run.state.history.length, 1);
  assert.equal(service.download(id).text, "# AI fixture 초안 r2\n");
  assert.equal(service.download(id, 1).text, "# AI fixture 초안 r1\n");
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
  assert.equal(service.download(id, 2).text, "# AI fixture 초안 r2\n");
  await assert.rejects(() => feedback(id, "flow-blocked-feedback"), { status: 409 });
  const count = calls.length;
  await delay(QUIET_MS);
  assert.equal(calls.length, count, "Failure must wait for an explicit user retry");

  forceFailure = false;
  await service.action(id, {
    operationId: "flow-retry",
    expectedVersion: run.state.version,
    type: "resume",
  });
  await approveBrief(id);
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
  assert.equal(service.download(id).text, "# AI fixture 초안 r3\n");
  assert.equal(run.state.approval, null);
  assert.equal(run.state.satisfiedRevision, null);
  // FIGURE-001: 확정 뒤 시각자료 위치 제안·생성도 같은 n8n 전달·대기 루프로 진행 · 사람 결정에서 멈춤
  const act = (type, extra = {}) =>
    service.action(id, {
      operationId: `flow-${type}`,
      expectedVersion: store.get(id).state.version,
      type,
      ...extra,
    });
  await act("satisfy");
  const text = service.download(id).text;
  await act("request_figures");
  run = await waitFor(id, "awaiting_figure_choice");
  assert.equal(calls.at(-1), "figure_plan");
  assert.equal(run.callsUsed, 1);
  const beforeChoice = calls.length;
  await delay(QUIET_MS);
  assert.equal(calls.length, beforeChoice, "Figure generation must wait for the human choice");
  await act("select_figures", { figures: ["f1"] });
  // 구성 결과도 사람 승인 전에는 생성하지 않는다 · ADR-0026
  run = await waitFor(id, "awaiting_figure_design");
  const beforeDesign = calls.length;
  await delay(QUIET_MS);
  assert.equal(calls.length, beforeDesign, "Figure generation must wait for design approval");
  await act("approve_design");
  run = await waitFor(id, "awaiting_figure_review");
  assert.deepEqual(calls.slice(-2 - FIGURE_PASSES.length), [
    "figure_plan",
    "figure_compose",
    ...FIGURE_PASSES.map(() => "figure"),
  ]);
  assert.equal(service.get(id).canAuthorizePublication, false);
  await act("confirm_figures");
  run = await waitFor(id, "satisfied");
  assert.deepEqual(
    run.state.figure.items.map((item) => item.id),
    ["f1"],
  );
  assert.equal(service.download(id).text, text);
  await act("authorize_publication");
  assert.deepEqual(store.get(id).state.approval.figures, ["f1"]);
  assert.equal(calls.length, beforeChoice + 1 + FIGURE_PASSES.length);
  console.log(
    "FLOW-001/FLOW-002/FIGURE-001 verified: full8, feedback/download revisions, failure gate, explicit retry, figure proposal/choice/compose/approval/generation/confirmation (fixture Jobs)",
  );
} finally {
  await runtime?.stop();
  await new Promise((done) => server.close(done));
  store.close();
  await scratch.release({ failed: process.exitCode !== undefined && process.exitCode !== 0 });
}
