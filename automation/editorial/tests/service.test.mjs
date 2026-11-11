import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { STAGES, transition } from "../domain/index.mjs";
import { EditorialService } from "../service.mjs";
import { EditorialStore } from "../store.mjs";

const output = {
  diagnose: {
    purpose: "설명",
    audience: "입문자",
    sectionModes: ["explanation"],
    preserveVoice: "의미 보존",
    strategy: "사례로 설명",
  },
  topic: { problem: "주문과 결제의 책임", scope: "쇼핑몰 구조" },
  audience: { reader: "입문자", intent: "책임 분리 이해" },
  value: { outcome: "설계 판단", preserve: ["의미"] },
  research: { evidence: [], uncertainties: ["실제 결제 정책은 추가 확인 필요"] },
  outline: { sections: ["주문", "결제"], rationale: "책임 순서" },
  draft: { text: "# 초안\n\n주문과 결제를 나눕니다.", changeSummary: "초고" },
  review: { findings: [], preservationCheck: "핵심 유지" },
};
async function fixture(t) {
  const dir = await mkdtemp(".local/editorial-test-");
  const store = new EditorialStore(join(dir, "state.sqlite"));
  t.after(() => service.store.close());
  const records = new Map(),
    calls = [],
    stops = [],
    dispatches = [];
  const jobs = {
    routeTarget: "draft",
    async create(body) {
      const id = JSON.stringify(body);
      if (records.has(id)) return records.get(id);
      calls.push(body);
      const state = body.state;
      const event = {
        id: `result-${calls.length}`,
        actor: "adapter",
        expectedVersion: state.version,
        revision: state.revision,
        ...(state.status === "waiting_route"
          ? { type: "route", target: jobs.routeTarget, reason: "표현 수정" }
          : {
              type: "complete",
              stage: state.stage,
              output: {
                ...output[state.stage],
                ...(state.stage === "draft"
                  ? { text: `# 초안 ${state.revision}\n\n주문과 결제를 나눕니다.` }
                  : {}),
              },
            }),
      };
      transition(state, event);
      const job = { id, status: "running", event };
      records.set(id, job);
      return job;
    },
    async poll(id) {
      const job = records.get(id);
      return { ...job, status: "completed" };
    },
    async find(body) {
      return records.get(JSON.stringify(body)) ?? null;
    },
    async stop(id) {
      stops.push(id);
      return { ...records.get(id), status: "failed" };
    },
  };
  const service = new EditorialService({
    store,
    jobs,
    dispatch: async (id) => {
      dispatches.push(id);
    },
  });
  return { service, store, dir, jobs, calls, stops, dispatches, records };
}
async function finish(service, id) {
  for (let i = 0; i < STAGES.length + 1; i++) if (!(await service.advance(id)).continue) return;
  throw new Error("Did not finish");
}
test("duplicate submit, persisted recovery, feedback revisions and exact downloads", async (t) => {
  const f = await fixture(t),
    s = f.service;
  const input = {
    requestId: "request-1",
    idea: "쇼핑몰 구조 설명",
    source: "확인한 자료",
    direction: { mode: "explain", readerLevel: "beginner" },
  };
  const [a, b] = await Promise.all([s.create(input), s.create(input)]);
  assert.equal(a.id, b.id);
  await s.advance(a.id);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].state.direction, input.direction);
  s.store.close();
  s.store = new EditorialStore(join(f.dir, "state.sqlite"));
  const restored = new EditorialService({ store: s.store, jobs: f.jobs, dispatch: s.dispatch });
  assert.deepEqual(s.store.get(a.id).state.direction, input.direction);
  await finish(restored, a.id);
  assert.equal(f.calls.length, STAGES.length);
  assert.equal(restored.get(a.id).status, "awaiting_user");
  const first = restored.download(a.id).text;
  const view = restored.get(a.id),
    action = {
      operationId: "feedback-1",
      type: "feedback",
      feedback: "사례를 자세히",
      expectedVersion: view.version,
    };
  await restored.action(a.id, action);
  await restored.action(a.id, action);
  assert.equal(restored.get(a.id).revision, 2);
  assert.equal(restored.get(a.id).textRevision, 1);
  assert.equal(restored.get(a.id).title, "초안 1");
  await finish(restored, a.id);
  assert.equal(restored.get(a.id).revision, 2);
  assert.equal(restored.get(a.id).textRevision, 2);
  assert.equal(f.calls.length, STAGES.length + 3);
  assert.equal(restored.download(a.id, 1).text, first);
  assert.notEqual(restored.download(a.id).text, first);
  await assert.rejects(() => restored.action(a.id, { ...action, operationId: "stale" }), {
    status: 409,
  });
  await assert.rejects(() => restored.create({ ...input, idea: "바뀐 글감" }), { status: 409 });
});
test("uncertain job response reuses reserved request after service restart", async (t) => {
  const f = await fixture(t),
    s = f.service,
    create = f.jobs.create;
  let once = true;
  f.jobs.create = async (body) => {
    const job = await create(body);
    if (once) {
      once = false;
      throw new Error("response lost");
    }
    return job;
  };
  const run = await s.create({ requestId: "uncertain", idea: "응답 유실" });
  await s.advance(run.id);
  assert.ok(s.get(run.id).issue);
  assert.equal(f.calls.length, 1);
  s.store.close();
  s.store = new EditorialStore(join(f.dir, "state.sqlite"));
  await s.action(run.id, {
    operationId: "reconnect",
    type: "resume",
    expectedVersion: s.get(run.id).version,
  });
  await s.advance(run.id);
  assert.equal(f.calls.length, 1);
  assert.equal(s.get(run.id).stage, "topic");
});
test("pause confirms cancellation before clearing pending work and does not advance", async (t) => {
  const f = await fixture(t),
    s = f.service;
  f.jobs.poll = async (id) => f.records.get(id);
  const run = await s.create({ requestId: "pause", idea: "중단할 글" });
  await s.advance(run.id);
  const stop = f.jobs.stop;
  f.jobs.stop = async () => {
    throw new Error("unknown cancel");
  };
  await assert.rejects(
    () =>
      s.action(run.id, {
        operationId: "stop-1",
        type: "pause",
        expectedVersion: s.get(run.id).version,
      }),
    { status: 503 },
  );
  assert.equal(s.get(run.id).status, "waiting_ai");
  assert.ok(s.store.get(run.id).pending);
  f.jobs.stop = stop;
  await s.action(run.id, {
    operationId: "stop-2",
    type: "pause",
    expectedVersion: s.get(run.id).version,
  });
  assert.equal(s.get(run.id).status, "paused");
  assert.equal(f.stops.length, 1);
  await s.advance(run.id);
  assert.equal(f.calls.length, 1);
  await s.action(run.id, {
    operationId: "resume",
    type: "resume",
    expectedVersion: s.get(run.id).version,
  });
  await s.advance(run.id);
  assert.equal(f.calls.length, 2);
});
test("server owns model and limits; worker cannot bypass exhausted budget", async (t) => {
  const f = await fixture(t),
    s = f.service;
  const run = await s.create({ requestId: "budget", idea: "기본 모델", ai: { model: "attacker" } });
  const record = s.store.get(run.id);
  record.callsUsed = STAGES.length;
  s.store.save(record);
  assert.deepEqual(await s.advance(run.id), { id: run.id, continue: false });
  assert.equal(f.calls.length, 0);
  assert.equal(s.get(run.id).status, "failed");
  assert.equal(s.get(run.id).label, "실패");
  assert.equal(record.ai.model, "gemini-3.8-flash-medium");
});

test("monitor distinguishes waiting, observed work and lost confirmation without starting AI", async (t) => {
  const f = await fixture(t),
    s = f.service;
  let now = 1000;
  s.now = () => now;
  f.jobs.poll = async (id) => f.records.get(id);
  const run = await s.create({ requestId: "observability", idea: "실제 상태 확인" });
  assert.equal(s.get(run.id).monitor.kind, "queued");
  assert.equal(f.calls.length, 0);
  now += 16000;
  assert.equal(s.get(run.id).monitor.kind, "stale");
  assert.equal(s.list()[0].label, "진행 확인 지연");
  await s.advance(run.id, { executionId: "42" });
  const live = s.get(run.id);
  assert.equal(live.monitor.kind, "working");
  assert.equal(live.monitor.lastConfirmedAt, now);
  assert.equal(live.monitor.executionId, "42");
  const eventCount = live.monitor.events.length;
  await s.advance(run.id, { executionId: "42" });
  assert.equal(s.get(run.id).monitor.events.length, eventCount);
  assert.ok(live.monitor.events.some((e) => e.kind === "ai_requested"));
  now += 16000;
  const saved = s.store.get(run.id);
  saved.updatedAt = now;
  s.store.save(saved);
  assert.equal(s.get(run.id).monitor.kind, "stale");
  assert.equal(f.calls.length, 1);
  await s.action(run.id, {
    operationId: "observe-reconnect",
    type: "resume",
    expectedVersion: s.get(run.id).version,
  });
  await s.advance(run.id, { executionId: "43" });
  assert.equal(f.calls.length, 1);
  assert.equal(s.get(run.id).monitor.kind, "working");
  s.store.close();
  s.store = new EditorialStore(join(f.dir, "state.sqlite"));
  assert.ok(s.get(run.id).monitor.events.some((e) => e.executionId === "42"));
  assert.equal(s.get(run.id).monitor.executionId, "43");
  await s.advance(run.id, { executionId: "42" });
  await s.advance(run.id, { executionId: "43" });
  assert.deepEqual(
    s
      .get(run.id)
      .monitor.events.filter((e) => e.kind === "connected")
      .map((e) => e.executionId),
    ["42", "43"],
  );
  assert.equal(f.calls.length, 1);
});

test("FLOW-001 full initial eight and diagnose reroute nine calls stay bounded", async (t) => {
  const f = await fixture(t),
    s = f.service;
  const run = await s.create({ requestId: "eight", idea: "전체 글쓰기", source: "자료\r\n  " });
  await finish(s, run.id);
  assert.deepEqual(
    f.calls.map((body) => body.state.stage),
    STAGES,
  );
  assert.ok(
    f.calls.every((body) => body.ai.maxCalls === STAGES.length && body.ai.maxRunMs === 600000),
  );
  const ready = s.get(run.id);
  assert.equal(ready.needsCompletion, false);
  assert.equal(ready.canCompleteRequirements, false);
  assert.deepEqual(
    ready.artifacts.map((a) => a.stage),
    STAGES,
  );
  assert.ok(
    ready.artifacts.every((a) => a.revision === 1 && a.name && typeof a.output === "object"),
  );
  assert.ok(ready.artifacts.every((a) => !Object.hasOwn(a, "reusedFromRevision")));
  assert.ok(ready.monitor.pipeline.every((step) => step.status === "done"));
  f.jobs.routeTarget = "diagnose";
  await s.action(run.id, {
    operationId: "all-again",
    type: "feedback",
    expectedVersion: ready.version,
    feedback: "목적부터 다시",
  });
  const routed = s.get(run.id);
  assert.equal(routed.maxCalls, STAGES.length + 1);
  assert.ok(routed.monitor.pipeline.slice(1).every((step) => step.status === "pending"));
  assert.deepEqual(routed.artifacts, []);
  await finish(s, run.id);
  assert.equal(f.calls.length, STAGES.length * 2 + 1);
  assert.equal(s.get(run.id).callsUsed, STAGES.length + 1);
  assert.equal(s.get(run.id).status, "awaiting_user");
  assert.equal(s.get(run.id).source, "자료\r\n  ");
});

test("user satisfaction and separate publication authorization never dispatch; feedback revokes both", async (t) => {
  const f = await fixture(t),
    s = f.service;
  const run = await s.create({ requestId: "approval", idea: "승인 구분" });
  await assert.rejects(
    () =>
      s.action(run.id, {
        operationId: "early",
        type: "satisfy",
        expectedVersion: s.get(run.id).version,
      }),
    { status: 409 },
  );
  await finish(s, run.id);
  const dispatches = f.dispatches.length,
    calls = f.calls.length;
  let view = s.get(run.id);
  assert.equal(view.canSatisfy, true);
  assert.equal(view.canAuthorizePublication, false);
  await assert.rejects(
    () =>
      s.action(run.id, {
        operationId: "skip",
        type: "authorize_publication",
        expectedVersion: view.version,
      }),
    { status: 409 },
  );
  const satisfy = { operationId: "satisfied", type: "satisfy", expectedVersion: view.version };
  view = await s.action(run.id, satisfy);
  await s.action(run.id, satisfy);
  assert.equal(view.status, "satisfied");
  assert.equal(view.label, "초안 확정");
  assert.equal(view.canSatisfy, false);
  assert.equal(view.canAuthorizePublication, true);
  assert.equal(view.canDownload, true);
  assert.equal(view.canFeedback, true);
  const text = s.download(run.id).text;
  const approve = {
    operationId: "authorize",
    type: "authorize_publication",
    expectedVersion: view.version,
  };
  view = await s.action(run.id, approve);
  await s.action(run.id, approve);
  assert.equal(view.status, "publication_ready");
  assert.equal(view.label, "발행 준비 승인");
  assert.equal(view.canAuthorizePublication, false);
  assert.equal(view.canDownload, true);
  assert.equal(view.canFeedback, true);
  assert.equal(s.download(run.id).text, text);
  assert.equal(f.dispatches.length, dispatches);
  assert.equal(f.calls.length, calls);
  view = await s.action(run.id, {
    operationId: "revoke",
    type: "feedback",
    expectedVersion: view.version,
    feedback: "다시 수정",
  });
  const state = f.store.get(run.id).state;
  assert.equal(state.satisfiedRevision, null);
  assert.equal(state.approval, null);
  assert.equal(view.canSatisfy, false);
  assert.equal(view.canAuthorizePublication, false);
  await s.advance(run.id);
  const promoted = f.store.get(run.id).state;
  assert.equal(promoted.stage, "draft");
  for (const stage of STAGES.slice(0, -2)) {
    assert.equal(promoted.artifacts[stage].revision, 2);
    assert.equal(promoted.artifacts[stage].reusedFromRevision, 1);
  }
  view = s.get(run.id);
  assert.deepEqual(
    view.artifacts.map((a) => [a.stage, a.revision, a.reusedFromRevision]),
    STAGES.slice(0, -2).map((stage) => [stage, 2, 1]),
  );
  assert.equal(view.monitor.pipeline.filter((step) => step.status === "done").length, 6);
  await finish(s, run.id);
  assert.ok(
    s
      .get(run.id)
      .artifacts.filter((a) => ["draft", "review"].includes(a.stage))
      .every((a) => !Object.hasOwn(a, "reusedFromRevision")),
  );
  assert.equal(s.get(run.id).monitor.pipeline.filter((step) => step.status === "done").length, 8);
});

// Historical compact runs are seeded as stored data, never through the strict start/complete contract.
async function legacy(f, requestId, { active = false, reserved = false } = {}) {
  const input = { requestId, idea: "  예전 글감\n보존", source: "자료\r\n\t원문  " };
  const created = await f.service.create(input);
  const run = f.store.get(created.id);
  run.state.plan = ["diagnose", "draft", "review"];
  run.state.status = active ? "waiting_ai" : "awaiting_user";
  run.state.stage = "review";
  run.state.version = 3;
  run.state.artifacts = {
    diagnose: { revision: 1, output: structuredClone(output.diagnose) },
    draft: {
      revision: 1,
      output: { text: "# 보존\r\n\r\n원문  \n", changeSummary: "예전 초고", extension: "보존" },
    },
  };
  run.state.history = [
    {
      revision: 0,
      status: "paused",
      artifacts: { draft: { revision: 0, output: { text: "더 오래된 초고\r\n" } } },
    },
  ];
  run.callsUsed = 2;
  if (reserved) {
    const body = {
      state: structuredClone(run.state),
      ai: { ...run.ai, callsUsed: 3, maxCalls: 3 },
    };
    run.pending = { body };
    f.records.set(JSON.stringify(body), {
      id: JSON.stringify(body),
      status: "running",
      event: {
        id: "legacy-result",
        actor: "adapter",
        type: "complete",
        expectedVersion: run.state.version,
        revision: run.state.revision,
        stage: "review",
        output: structuredClone(output.review),
      },
    });
  }
  f.store.save(run);
  return { run, input };
}

test("legacy get/list/duplicate/connect/advance preserve data and never create or dispatch jobs", async (t) => {
  const f = await fixture(t),
    s = f.service;
  for (const active of [false, true]) {
    const { run, input } = await legacy(f, `legacy-${active}`, { active });
    const before = f.store.get(run.id),
      dispatched = f.dispatches.length;
    const view = s.get(run.id);
    assert.equal(view.needsCompletion, true);
    assert.equal(view.canCompleteRequirements, true);
    assert.match(view.completionReason, /전체 글쓰기/);
    assert.equal(view.issue, view.completionReason);
    assert.equal(view.canFeedback, false);
    assert.equal(view.canSatisfy, false);
    assert.equal(view.canAuthorizePublication, false);
    assert.equal(view.canDownload, true);
    assert.equal(view.text, before.state.artifacts.draft.output.text);
    assert.equal(s.download(run.id).text, before.state.artifacts.draft.output.text);
    assert.equal(s.download(run.id, 0).text, "더 오래된 초고\r\n");
    assert.equal(s.list().find((r) => r.id === run.id).needsCompletion, true);
    assert.equal(s.list().find((r) => r.id === run.id).completionReason, view.completionReason);
    await s.create(input);
    await s.connect(run.id);
    assert.deepEqual(await s.advance(run.id, { executionId: "legacy" }), {
      id: run.id,
      continue: false,
    });
    for (const type of ["feedback", "resume", "satisfy", "authorize_publication"])
      await assert.rejects(
        () =>
          s.action(run.id, {
            operationId: `blocked-${type}`,
            type,
            expectedVersion: before.state.version,
            feedback: "수정",
          }),
        { status: 409 },
      );
    assert.deepEqual(f.store.get(run.id), before);
    assert.equal(f.dispatches.length, dispatched);
    assert.equal(f.calls.length, 0);
  }
});

test("explicit completion archives exact partial draft/history, starts all8 and is idempotent/stale-safe", async (t) => {
  const f = await fixture(t),
    s = f.service;
  const { run } = await legacy(f, "complete");
  const original = structuredClone(run.state),
    dispatches = f.dispatches.length;
  const command = {
    operationId: "complete-command",
    type: "complete_requirements",
    expectedVersion: original.version,
  };
  const view = await s.action(run.id, command);
  const stored = f.store.get(run.id);
  assert.equal(stored.state.schemaVersion, 1);
  assert.equal(view.revision, original.revision + 1);
  assert.equal(view.stage, "diagnose");
  assert.equal(view.needsCompletion, false);
  assert.equal(view.canCompleteRequirements, false);
  assert.equal(view.text, original.artifacts.draft.output.text);
  assert.equal(view.canDownload, true);
  assert.equal(s.download(run.id).text, original.artifacts.draft.output.text);
  assert.equal(stored.state.source, original.source);
  assert.equal(stored.state.idea, original.idea);
  assert.deepEqual(stored.state.plan, STAGES);
  assert.deepEqual(stored.state.artifacts, {});
  assert.deepEqual(stored.state.history.slice(0, -1), original.history);
  assert.deepEqual(stored.state.history.at(-1).artifacts, original.artifacts);
  assert.equal(stored.state.history.at(-1).status, original.status);
  assert.equal(view.previous.at(-1).reviewed, false);
  assert.equal(s.download(run.id, original.revision).text, original.artifacts.draft.output.text);
  assert.equal(stored.callsUsed, 0);
  assert.equal(stored.maxCalls, STAGES.length);
  assert.equal(f.dispatches.length, dispatches + 1);
  await s.action(run.id, command);
  assert.deepEqual(f.store.get(run.id), stored);
  assert.equal(f.dispatches.length, dispatches + 1);
  await assert.rejects(() => s.action(run.id, { ...command, operationId: "stale" }), {
    status: 409,
  });
  await assert.rejects(
    () => s.action(run.id, { ...command, operationId: "unneeded", expectedVersion: view.version }),
    { status: 409 },
  );
  assert.equal(f.calls.length, 0);
  await finish(s, run.id);
  assert.equal(f.calls.length, STAGES.length);
  assert.equal(s.download(run.id, original.revision).text, original.artifacts.draft.output.text);
});

test("active legacy completion resolves response-lost reservation and requires confirmed stop", async (t) => {
  const f = await fixture(t),
    s = f.service;
  const { run } = await legacy(f, "legacy-active", { active: true, reserved: true });
  const before = f.store.get(run.id),
    dispatches = f.dispatches.length;
  const stop = f.jobs.stop;
  f.jobs.stop = async (id) => ({ ...f.records.get(id), status: "running" });
  const command = {
    operationId: "complete-active",
    type: "complete_requirements",
    expectedVersion: run.state.version,
  };
  await assert.rejects(() => s.action(run.id, command), { status: 503 });
  const uncertain = f.store.get(run.id);
  assert.equal(s.get(run.id).issue, uncertain.issue);
  assert.match(s.get(run.id).issue, /중단을 확인하지 못했습니다/);
  assert.notEqual(s.get(run.id).issue, s.get(run.id).completionReason);
  assert.deepEqual(uncertain.state, before.state);
  assert.deepEqual(uncertain.pending, before.pending);
  assert.equal(uncertain.callsUsed, before.callsUsed);
  assert.equal(f.dispatches.length, dispatches);
  assert.equal(f.calls.length, 0);
  f.jobs.stop = stop;
  await s.action(run.id, command);
  const completed = f.store.get(run.id);
  assert.equal(completed.pending, null);
  assert.equal(completed.state.stage, "diagnose");
  assert.deepEqual(completed.state.history.at(-1).artifacts, before.state.artifacts);
  assert.equal(f.stops.length, 1);
  assert.equal(f.dispatches.length, dispatches + 1);
});

test("already completed legacy pending result is preserved separately from the old draft", async (t) => {
  const f = await fixture(t),
    s = f.service;
  const { run } = await legacy(f, "legacy-completed", { active: true, reserved: true });
  const jobId = JSON.stringify(run.pending.body),
    job = f.records.get(jobId);
  job.event = {
    ...job.event,
    stage: "draft",
    output: { text: "完了した別の原稿\r\n  ", changeSummary: "旧応答" },
  };
  job.status = "completed";
  f.jobs.stop = async () => structuredClone(job);
  await s.action(run.id, {
    operationId: "completed-old",
    type: "complete_requirements",
    expectedVersion: run.state.version,
  });
  const snapshot = f.store.get(run.id).state.history.at(-1);
  assert.deepEqual(snapshot.artifacts, run.state.artifacts);
  assert.deepEqual(snapshot.pendingResult, { jobId, event: job.event });
  assert.equal(s.download(run.id, 1).text, run.state.artifacts.draft.output.text);
  assert.equal(f.calls.length, 0);
});

test("mere reconnect retains elapsed budget; paused resume and failed retry reset explicitly", async (t) => {
  const f = await fixture(t),
    s = f.service;
  let now = 1000;
  s.now = () => now;
  const run = await s.create({ requestId: "elapsed", idea: "시간 한도" });
  await s.advance(run.id);
  const before = f.store.get(run.id);
  before.issue = "연결 불확실";
  before.issueKind = "ai_connection";
  f.store.save(before);
  now = 200000;
  await s.action(run.id, {
    operationId: "reconnect-budget",
    type: "resume",
    expectedVersion: before.state.version,
  });
  let saved = f.store.get(run.id);
  assert.equal(saved.callsUsed, before.callsUsed);
  assert.equal(saved.startedAt, before.startedAt);
  assert.equal(saved.maxCalls, before.maxCalls);
  now = 601001;
  await s.advance(run.id);
  assert.equal(s.get(run.id).status, "failed");
  assert.equal(f.calls.length, 1);
  await s.action(run.id, {
    operationId: "retry-budget",
    type: "resume",
    expectedVersion: s.get(run.id).version,
  });
  saved = f.store.get(run.id);
  assert.equal(saved.callsUsed, 0);
  assert.equal(saved.startedAt, now);
  assert.equal(saved.maxCalls, STAGES.length + 1);
  await s.action(run.id, {
    operationId: "pause-budget",
    type: "pause",
    expectedVersion: saved.state.version,
  });
  now += 1000;
  await s.action(run.id, {
    operationId: "resume-budget",
    type: "resume",
    expectedVersion: s.get(run.id).version,
  });
  saved = f.store.get(run.id);
  assert.equal(saved.callsUsed, 0);
  assert.equal(saved.startedAt, now);
  assert.equal(saved.maxCalls, STAGES.length + 1);
});

test("confirmed legacy pause preserves a completed pending result without a strict completion bypass", async (t) => {
  const f = await fixture(t),
    s = f.service;
  const { run } = await legacy(f, "legacy-pause-completed", { active: true, reserved: true });
  const jobId = JSON.stringify(run.pending.body),
    job = f.records.get(jobId);
  job.status = "completed";
  f.jobs.stop = async () => structuredClone(job);
  const dispatches = f.dispatches.length;
  const pause = { operationId: "legacy-pause", type: "pause", expectedVersion: run.state.version };
  let view = await s.action(run.id, pause);
  const paused = f.store.get(run.id);
  assert.equal(view.status, "paused");
  assert.equal(view.needsCompletion, true);
  assert.equal(view.canCompleteRequirements, true);
  assert.equal(paused.pending, null);
  assert.deepEqual(paused.state.artifacts, run.state.artifacts);
  assert.equal(paused.state.revision, run.state.revision);
  assert.deepEqual(paused.legacyPendingResult, { jobId, event: job.event });
  await s.action(run.id, pause);
  assert.deepEqual(f.store.get(run.id), paused);
  assert.equal(f.dispatches.length, dispatches);
  view = await s.action(run.id, {
    operationId: "paused-legacy-complete",
    type: "complete_requirements",
    expectedVersion: view.version,
  });
  const completed = f.store.get(run.id);
  assert.equal(view.stage, "diagnose");
  assert.deepEqual(completed.state.history.at(-1).pendingResult, paused.legacyPendingResult);
  assert.deepEqual(completed.state.history.at(-1).artifacts, run.state.artifacts);
  assert.equal(completed.legacyPendingResult, undefined);
  assert.equal(s.download(run.id, run.state.revision).text, run.state.artifacts.draft.output.text);
  assert.equal(f.calls.length, 0);
  assert.equal(f.dispatches.length, dispatches + 1);
});
test("archive hides finished work from the list, keeps data and refuses running work", async (t) => {
  const f = await fixture(t),
    s = f.service;
  const { id } = await s.create({ requestId: "archive-1", idea: "삭제할 글" });
  await assert.rejects(() => s.archive(id), { status: 409 });
  await finish(s, id);
  assert.deepEqual(await s.archive(id), { id, archived: true });
  await s.archive(id);
  assert.equal(s.list().length, 0);
  assert.equal(s.get(id).status, "awaiting_user");
  assert.equal(f.store.get(id).events.filter((e) => e.kind === "archived").length, 1);
});
