import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { transition } from "../../editorial/domain/index.mjs";
import { makeServer } from "../../runtime/server.mjs";
import { Jobs } from "../jobs.mjs";

const valid = JSON.stringify({
  purpose: "검증 fixture",
  audience: "개발자",
  sectionModes: ["explanation"],
  preserveVoice: "의미",
  strategy: "목적에 맞게",
});
const start = () =>
  transition(null, {
    id: "fixture-start",
    actor: "user",
    type: "start",
    articleId: "test",
    idea: "테스트 과업",
  }).state;
async function setup(statuses = [{ status: "idle", lastMessage: valid }]) {
  const base = resolve(".local/paseo-tests");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "run-"));
  const calls = [];
  const archived = [];
  const remaining = [...statuses];
  const client = {
    providers: {
      waitForReady: async () => ({
        entries: [
          {
            provider: "antigravity",
            status: "ready",
            models: [{ id: "fixture-model", isDefault: true }],
          },
          { provider: "other", status: "ready", models: [{ id: "other-model" }] },
        ],
      }),
    },
    agents: {
      create: async (opts) => {
        calls.push(opts);
        return { id: "fixture-agent" };
      },
      ref: (id) => ({
        waitForFinish: async () => remaining.shift() ?? { status: "idle", lastMessage: valid },
        archive: async () => {
          archived.push(id);
          return { archivedAt: new Date().toISOString() };
        },
      }),
    },
  };
  return {
    root,
    calls,
    archived,
    client,
    jobs: new Jobs({ client, root: join(root, "jobs"), workRoot: join(root, "work") }),
  };
}
test("concurrent HTTP retries and bridge restart reuse the persisted job", async () => {
  const t = await setup();
  const body = {
    state: start(),
    ai: { provider: "antigravity", model: "fixture-model", enabled: true },
  };
  const [a, b] = await Promise.all([t.jobs.create(body), t.jobs.create(body)]);
  assert.equal(a.id, b.id);
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].config.provider, "antigravity/fixture-model");
  const reopened = new Jobs({
    client: t.client,
    root: join(t.root, "jobs"),
    workRoot: join(t.root, "work"),
  });
  assert.equal((await reopened.create(body)).id, a.id);
  assert.equal(t.calls.length, 1);
  const done = await reopened.poll(a.id);
  assert.equal(done.status, "completed");
  assert.equal(transition(done.state, done.event).state.stage, "topic");
});
test("timeout and permission do not complete or automatically retry a job", async () => {
  const t = await setup([
    { status: "timeout" },
    { status: "permission" },
    { status: "idle", lastMessage: valid },
  ]);
  const job = await t.jobs.create({
    state: start(),
    ai: { provider: "antigravity", model: "fixture-model" },
  });
  assert.equal((await t.jobs.poll(job.id)).status, "running");
  assert.equal((await t.jobs.poll(job.id)).status, "permission");
  assert.equal((await t.jobs.poll(job.id)).status, "completed");
  assert.equal(t.calls.length, 1);
});

test("FLOW-001: incomplete plans and missing current prerequisites never create AI sessions", async () => {
  const fixture = await setup();
  for (const state of [
    { ...start(), plan: ["diagnose", "draft", "review"] },
    { ...start(), stage: "draft" },
    { ...start(), stage: "review" },
  ]) {
    await assert.rejects(
      () => fixture.jobs.create({ state, ai: { provider: "antigravity", model: "fixture-model" } }),
      /No pending AI action/,
    );
  }
  assert.equal(fixture.calls.length, 0);
});
test("provider/model selection is explicit; changing provider creates a distinct session", async () => {
  const t = await setup();
  const state = start();
  await assert.rejects(
    t.jobs.create({ state, ai: { provider: "missing", model: "fixture-model" } }),
    /unavailable/,
  );
  await assert.rejects(
    t.jobs.create({ state, ai: { provider: "antigravity", model: "missing" } }),
    /unavailable/,
  );
  const a = await t.jobs.create({ state, ai: { provider: "antigravity", model: "fixture-model" } });
  const b = await t.jobs.create({ state, ai: { provider: "other", model: "other-model" } });
  assert.notEqual(a.id, b.id);
  assert.equal(t.calls[1].config.provider, "other/other-model");
  assert.equal(t.calls[0].prompt.includes("도구·파일·쉘·위임·발행 금지"), true);
});
test("finished sessions are archived so idle provider processes do not accumulate", async () => {
  const ai = { provider: "antigravity", model: "fixture-model" };
  for (const [statuses, final] of [
    [[{ status: "timeout" }, { status: "idle", lastMessage: valid }], "completed"],
    [[{ status: "timeout" }, { status: "idle", lastMessage: "not json" }], "failed"],
  ]) {
    const t = await setup(statuses);
    const a = await t.jobs.create({ state: start(), ai });
    assert.equal((await t.jobs.poll(a.id)).status, "running");
    assert.deepEqual(t.archived, []);
    assert.equal((await t.jobs.poll(a.id)).status, final);
    assert.equal(t.archived.length, 1);
  }
});

test("invalid AI JSON or forbidden route is a failure, never a synthetic completion", async () => {
  const t = await setup([{ status: "idle", lastMessage: "not json" }]);
  const a = await t.jobs.create({
    state: start(),
    ai: { provider: "antigravity", model: "fixture-model" },
  });
  const result = await t.jobs.poll(a.id);
  assert.equal(result.status, "failed");
  assert.equal(result.event, undefined);
});
test("startup interruption does not create a second agent silently", async () => {
  const t = await setup();
  const a = await t.jobs.create({
    state: start(),
    ai: { provider: "antigravity", model: "fixture-model" },
  });
  delete a.agentId;
  a.status = "starting";
  await t.jobs.save(a);
  assert.equal((await t.jobs.poll(a.id)).status, "needs_attention");
  assert.equal(t.calls.length, 1);
});
test("retired raw endpoints cannot bypass the editorial application", async (t) => {
  const fixture = await setup();
  const server = makeServer({ token: "t".repeat(64) });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ["/jobs", "/jobs/anything", "/exports", "/providers"]) {
    const result = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(result.status, 410);
  }
  assert.equal(fixture.calls.length, 0);
});

test("missing model is rejected before any session starts even if a default exists", async () => {
  const t = await setup();
  for (const model of [null, undefined, "", " "])
    await assert.rejects(
      t.jobs.create({ state: start(), ai: { provider: "antigravity", model } }),
      /Explicit model/,
    );
  assert.equal(t.calls.length, 0);
});

test("deadline watchdog stops an owned job once even if n8n stops polling", async () => {
  const t = await setup([{ status: "timeout" }]);
  const stopped = [];
  t.jobs.cancel = async (id) => {
    stopped.push(id);
  };
  const job = await t.jobs.create({
    state: start(),
    ai: { provider: "antigravity", model: "fixture-model" },
  });
  job.deadline = Date.now() - 1;
  await t.jobs.save(job);
  await t.jobs.expire();
  await t.jobs.expire();
  assert.deepEqual(stopped, ["fixture-agent"]);
  assert.equal((await t.jobs.read(job.id)).failureKind, "timeout");
  assert.equal(t.calls.length, 1);
});
test("a completed response is recovered at the deadline instead of discarded", async () => {
  const t = await setup();
  let stopped = false;
  t.jobs.cancel = async () => {
    stopped = true;
  };
  const job = await t.jobs.create({
    state: start(),
    ai: { provider: "antigravity", model: "fixture-model" },
  });
  job.deadline = Date.now() - 1;
  await t.jobs.save(job);
  assert.equal((await t.jobs.poll(job.id)).status, "completed");
  assert.equal(stopped, false);
});

test("stop requires confirmed terminal agent and remains idempotent", async () => {
  const t = await setup([{ status: "timeout" }, { status: "error", error: "cancelled" }]);
  let stops = 0;
  t.jobs.cancel = async () => {
    stops += 1;
  };
  const body = { state: start(), ai: { provider: "antigravity", model: "fixture-model" } };
  const job = await t.jobs.create(body);
  assert.equal((await t.jobs.find(body)).id, job.id);
  await assert.rejects(() => t.jobs.stop(job.id), /not been confirmed/);
  assert.equal((await t.jobs.read(job.id)).status, "running");
  assert.equal((await t.jobs.stop(job.id)).failureKind, "cancelled");
  await t.jobs.stop(job.id);
  assert.equal(stops, 2);
  assert.equal(t.calls.length, 1);
});

test("deadline keeps an unconfirmed stop pending instead of enabling duplicate work", async () => {
  const t = await setup([{ status: "timeout" }, { status: "timeout" }]);
  let stops = 0;
  t.jobs.cancel = async () => {
    stops += 1;
  };
  const job = await t.jobs.create({
    state: start(),
    ai: { provider: "antigravity", model: "fixture-model" },
  });
  job.deadline = Date.now() - 1;
  await t.jobs.save(job);
  await t.jobs.expire();
  await t.jobs.expire();
  assert.equal((await t.jobs.read(job.id)).status, "needs_attention");
  assert.equal(stops, 1);
  assert.equal(t.calls.length, 1);
});

test("HISTORY-001: describe reads persisted input selection and whitelisted results without running AI", async () => {
  const f = await setup();
  const job = await f.jobs.create({
    state: start(),
    ai: { provider: "antigravity", model: "fixture-model" },
  });
  await f.jobs.poll(job.id);
  const stored = await f.jobs.read(job.id);
  stored.event.output.privateExtension = "excluded";
  await f.jobs.save(stored);
  const before = f.calls.length;
  const info = await f.jobs.describe(job.id);
  assert.equal(f.calls.length, before);
  assert.equal(info.inputsRecorded, true);
  assert.equal(info.inputs.stages.length, 0);
  assert.equal(info.output.purpose, "검증 fixture");
  assert.equal(Object.hasOwn(info.output, "privateExtension"), false);
  assert.equal(Object.hasOwn(info, "state"), false);
  assert.equal(Object.hasOwn(info, "diagnostic"), false);
  delete stored.inputSummary;
  await f.jobs.save(stored);
  assert.equal((await f.jobs.describe(job.id)).inputsRecorded, false);
});
