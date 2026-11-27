import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test, { after } from "node:test";
import { stageOutputExamples } from "../../contracts/ai-output.mjs";
import { nextAction, partActions, transition } from "../../editorial/domain/index.mjs";
import { scratchDir } from "../../runtime/scratch.mjs";
import { judgeBatch } from "../figure-batch.mjs";
import { Jobs } from "../jobs.mjs";
import { buildPrompt, promptData } from "../prompts/index.mjs";
import { resultEvent } from "../results.mjs";
import { roleOf, sessionEndsAfter, sessionKeyOf } from "../roles.mjs";

const scratch = await scratchDir("paseo-tests");
after(() => scratch.release());

// FIGURE-001: 시각자료 담당(illustrator) · 본문 불변 · AI는 fixture
const ANCHOR = "주문과 결제는 책임이 다릅니다.";
const SOURCE = "비공개 참고 자료";
const SVG = '<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>';
let seq = 0;
const send = (state, type, data = {}) =>
  transition(state, {
    id: `e${++seq}`,
    actor: ["complete", "figure_result"].includes(type) ? "adapter" : "user",
    type,
    expectedVersion: state?.version,
    ...data,
  }).state;
function proposing(note) {
  let state = send(null, "start", { articleId: "figure-job", idea: "쇼핑몰 구조", source: SOURCE });
  while (state.status === "waiting_ai")
    state = send(state, "complete", {
      stage: state.stage,
      revision: 1,
      output:
        state.stage === "draft"
          ? { text: `# 제목\n\n${ANCHOR} 그래서 나눕니다.`, changeSummary: "초고" }
          : state.stage === "outline"
            ? { sections: ["주문"], rationale: "순서" }
            : state.stage === "diagnose"
              ? { ...stageOutputExamples.diagnose, primaryMode: "explain", readerLevel: "beginner" }
              : stageOutputExamples[state.stage],
    });
  state = send(state, "satisfy", { reviewedRevision: 1 });
  return send(state, "request_figures", { reviewedRevision: 1, ...(note ? { note } : {}) });
}
const plan = {
  candidates: [
    { anchor: ANCHOR, claim: "책임 경계", reason: "이유", scene: "장면", kind: "diagram" },
  ],
};
const data = promptData;

test("ADR-0017·ADR-0026 담당 세션: 그림마다 따로, 그리기·수정은 같은 그린 담당", () => {
  const step = (pass, figureId) => ({ type: "request_figure", stage: "figure", pass, figureId });
  assert.deepEqual(
    [
      sessionKeyOf({ type: "request_figure", stage: "figure_plan" }),
      sessionKeyOf(step("draw", "f1")),
      sessionKeyOf(step("draw", "f2")),
    ],
    ["illustrator", "illustrator:f1", "illustrator:f2"],
  );
  assert.equal(roleOf(step("fix", "f1")), "illustrator");
  // 마친 그림의 세션은 대기시키지 않음: 그리기 한 층·수정 뒤에는 이어 맡을 작업이 없다
  assert.deepEqual(
    ["draw", "fix"].map((pass) => sessionEndsAfter(step(pass, "f1"))),
    [true, true],
  );
  assert.equal(sessionEndsAfter({ type: "request_figure", stage: "figure_plan" }), false);
});

test("FIGURE-001 프롬프트: 확정 본문만 주고 본문 수정 금지 · 생성은 고른 후보만", () => {
  let state = proposing();
  let action = nextAction(state);
  assert.equal(roleOf(action), "illustrator");
  let prompt = buildPrompt(state, action);
  assert.match(prompt, /본문 수정이나 재작성은 제안하지 않는다/);
  assert.match(prompt, /글자 하나 바꾸지 않고 그대로 복사/);
  assert.match(prompt, /"candidates":\[\{"anchor"/);
  assert.equal(prompt.includes(SOURCE), false);
  assert.deepEqual(Object.keys(data(prompt).artifacts), ["audience", "value", "outline", "draft"]);
  const event = resultEvent({ id: "job", state, action }, JSON.stringify(plan));
  assert.deepEqual(
    { type: event.type, stage: event.stage, actor: event.actor },
    { type: "figure_result", stage: "figure_plan", actor: "adapter" },
  );
  state = transition(state, event).state;
  state = send(state, "select_figures", { reviewedRevision: 1, figures: ["f1"] });
  // 구성: 고른 자리 전부와 글 전체를 받아 장면 세계·자리별 장면을 한 번에 정한다 · ADR-0026
  action = nextAction(state);
  assert.equal(roleOf(action), "illustrator");
  prompt = buildPrompt(state, action);
  assert.match(prompt, /"designs":\[\{"id"/);
  assert.match(prompt, /world에는 모든 그림이 한 글에 속해 보이게 하는 공통 배경/);
  const composed = resultEvent(
    { id: "job-compose", state, action },
    JSON.stringify({ world: "한 가게", designs: [{ id: "f1", scene: "장면", analogy: "가게" }] }),
  );
  assert.equal(composed.stage, "figure_compose");
  state = transition(state, composed).state;
  state = send(state, "approve_design", { reviewedRevision: 1 });
  // 생성 묶음은 실행기가 그림 한 장 작업으로 나눠 돌린다 · 프롬프트는 한 장 단위 · ADR-0026
  [action] = partActions(nextAction(state));
  prompt = buildPrompt(state, action);
  assert.deepEqual(data(prompt).candidates, [
    {
      id: "f1",
      anchor: ANCHOR,
      claim: "책임 경계",
      reason: "이유",
      kind: "diagram",
      analogy: "가게",
      scene: "장면",
    },
  ]);
  assert.equal(data(prompt).world, "한 가게");
  assert.match(prompt, /script·foreignObject/);
  const job = { id: "job2", state, action };
  // 실행 가능한 SVG·형식 위반은 결과로 인정하지 않음
  assert.throws(() =>
    resultEvent(
      job,
      JSON.stringify({ figures: [{ id: "f1", svg: "<svg><script/></svg>", alt: "a" }] }),
    ),
  );
  // 한 층에서 구도 → 판정 → 세부·마감 → 배치를 차례로 밟는다
  assert.match(
    prompt,
    /준비:[\s\S]*작성:[\s\S]*글자 뺀 PNG로 스스로 판정한다[\s\S]*마감:[\s\S]*prefers-reduced-motion/,
  );
  const out = JSON.stringify({ figures: [{ id: "f1", svg: SVG, alt: "설명", notes: "구도" }] });
  state = transition(state, resultEvent(job, out)).state;
  assert.equal(state.status, "awaiting_figure_review");
});

test("FIGURE-001 작업: 시각자료 요청은 담당 세션 하나 · 본문에 없는 앵커는 실패로 남김", async () => {
  const root = await mkdtemp(join(scratch.path, "run-"));
  const calls = [];
  const replies = [
    JSON.stringify(plan),
    JSON.stringify({
      candidates: [{ anchor: "없는 문장", claim: "x", reason: "이유", scene: "장면" }],
    }),
  ];
  const client = {
    providers: {
      waitForReady: async () => ({
        entries: [{ provider: "fixture", status: "ready", models: [{ id: "fixture-model" }] }],
      }),
    },
    agents: {
      create: async (options) => {
        calls.push(options);
        return { id: options.agentId };
      },
      ref: () => ({
        waitForFinish: async () => ({ status: "idle", lastMessage: replies.shift() }),
        archive: async () => ({}),
      }),
    },
  };
  const jobs = new Jobs({ client, root: join(root, "jobs"), workRoot: join(root, "work") });
  const ai = { provider: "fixture", model: "fixture-model" };
  const state = proposing();
  const created = await jobs.create({ state, ai });
  assert.equal((await jobs.create({ state, ai })).id, created.id);
  assert.equal(calls.length, 1);
  assert.equal(created.role, "illustrator");
  assert.match(calls[0].title, /figure_plan/);
  const done = await jobs.poll(created.id);
  assert.equal(done.status, "completed");
  assert.equal(done.event.type, "figure_result");
  const described = await jobs.describe(created.id);
  assert.deepEqual(described.output, { candidates: [{ claim: "책임 경계", anchor: ANCHOR }] });
  const other = await jobs.create({
    state: { ...state, version: state.version },
    ai: { ...ai, n: 2 },
  });
  const failed = await jobs.poll(other.id);
  assert.deepEqual([failed.status, failed.failureKind], ["failed", "invalid_output"]);
});

// ADR-0026: 같은 층의 그림들은 장마다 세션을 따로 두고 동시에 시작하며, 모두 끝나면 결과를 합쳐 한 번에 넘긴다
// 형식 오류는 같은 세션에 한 번 다시 묻는다 · 실제 대기 없이 결과가 정해질 때까지 확인을 되풀이
async function settled(jobs, id) {
  for (let turn = 0; turn < 5; turn += 1) {
    const job = await jobs.poll(id);
    if (job.status !== "running") return job;
  }
  throw new Error("batch did not settle");
}
// broken: 잘못된 결과를 내는 그림 id
async function figureBatch(broken = new Set()) {
  const root = await mkdtemp(join(scratch.path, "batch-"));
  const second = "그래서 나눕니다.";
  let state = proposing();
  state = transition(
    state,
    resultEvent(
      { id: "plan", state, action: nextAction(state) },
      JSON.stringify({
        candidates: [
          { anchor: ANCHOR, claim: "책임 경계", reason: "이유", kind: "diagram" },
          { anchor: second, claim: "나눔", reason: "이유", kind: "diagram" },
        ],
      }),
    ),
  ).state;
  state = send(state, "select_figures", { reviewedRevision: 1, figures: ["f1", "f2"] });
  state = transition(
    state,
    resultEvent(
      { id: "compose", state, action: nextAction(state) },
      JSON.stringify({
        world: "한 가게",
        designs: [
          { id: "f1", scene: "장면 1" },
          { id: "f2", scene: "장면 2" },
        ],
      }),
    ),
  ).state;
  state = send(state, "approve_design", { reviewedRevision: 1 });
  const created = [];
  const finished = new Set();
  const client = {
    providers: {
      waitForReady: async () => ({
        entries: [{ provider: "fixture", status: "ready", models: [{ id: "fixture-model" }] }],
      }),
    },
    agents: {
      create: async (options) => {
        created.push(options);
        return { id: options.agentId };
      },
      ref: (agentId) => ({
        waitForFinish: async () => {
          // 자식은 동시에 만들어지므로 생성 순서가 아니라 작업 기록의 그림 id로 찾는다
          const records = await Promise.all(
            (await readdir(join(root, "jobs")))
              .filter((name) => name.endsWith(".json"))
              .map(async (name) => JSON.parse(await readFile(join(root, "jobs", name), "utf8"))),
          );
          const id = records.find((job) => job.agentId === agentId).action.figureId;
          finished.add(Number(id.slice(1)) - 1);
          return {
            status: "idle",
            // 계약 위반(다른 그림 id)은 다시 묻지 않고 그 장만 실패
            lastMessage: JSON.stringify({
              figures: [{ id: broken.has(id) ? "f9" : id, svg: SVG, alt: `${id} 설명` }],
            }),
          };
        },
        archive: async () => ({}),
        timeline: undefined,
      }),
    },
  };
  const jobs = new Jobs({ client, root: join(root, "jobs"), workRoot: join(root, "work") });
  const ai = { provider: "fixture", model: "fixture-model" };
  const batch = await jobs.create({ state, ai });
  return { state, jobs, batch, created, finished, ai };
}

test("ADR-0026 묶음 생성 시작: 어느 장도 끝나기 전에 모든 장의 세션이 시작된다", async () => {
  const { state, jobs, batch, created, finished, ai } = await figureBatch();
  // 어느 장도 끝나기 전에 두 장의 세션이 모두 시작된다
  assert.deepEqual([created.length, finished.size], [2, 0]);
  assert.deepEqual(
    created.map((options) => options.title.includes("figure·draw")),
    [true, true],
  );
  assert.equal((await jobs.create({ state, ai })).id, batch.id);
  assert.equal(created.length, 2);
});

test("ADR-0026 묶음 생성: 그림마다 동시에 작업을 만들고 결과를 합친다", async () => {
  const { state, jobs, batch } = await figureBatch();
  const done = await jobs.poll(batch.id);
  assert.deepEqual(
    [done.status, done.event.figureIds, done.event.output.figures.map((f) => f.id)],
    ["completed", ["f1", "f2"], ["f1", "f2"]],
  );
  const next = transition(state, done.event).state;
  assert.equal(next.status, "awaiting_figure_review");
  assert.equal((await jobs.describe(batch.id)).figure.id, "f1,f2");
});

// 한 장이 실패해도 그린 장은 결과로 넘기고, 실패한 장만 사유와 함께 다시 그릴 수 있다
test("ADR-0026 그림 단위 실패: 그린 장은 보존하고 실패한 장만 다시 그린다", async () => {
  const { state, jobs, batch } = await figureBatch(new Set(["f2"]));
  const done = await settled(jobs, batch.id);
  assert.equal(done.status, "completed", `${done.error} ${done.diagnostic}`);
  assert.deepEqual(
    done.event.output.figures.map((f) => f.id),
    ["f1"],
  );
  assert.deepEqual(
    done.event.failed.map((f) => f.id),
    ["f2"],
  );
  let next = transition(state, done.event).state;
  assert.equal(next.status, "awaiting_figure_review");
  assert.deepEqual(
    next.figure.items.map((item) => item.id),
    ["f1"],
  );
  assert.deepEqual(Object.keys(next.figure.failed), ["f2"]);
  next = send(next, "retry_figures", { reviewedRevision: 1, figures: ["f2"] });
  assert.deepEqual(nextAction(next).figureIds, ["f2"]);
  assert.deepEqual(
    next.figure.items.map((item) => item.id),
    ["f1"],
  );
  assert.equal(next.figure.failed, undefined);
});

test("ADR-0026 그림 단위 실패: 모두 실패하면 묶음 실패", async () => {
  const { jobs, batch } = await figureBatch(new Set(["f1", "f2"]));
  assert.equal((await settled(jobs, batch.id)).status, "failed");
});

test("FIGURE-001 위치 지시: 사용자 지시가 위치 제안·생성 프롬프트에 우선 기준으로 전달", () => {
  const base = proposing();
  // 지시 없으면 기본 기준만
  assert.equal(data(buildPrompt(base, nextAction(base))).placementNote, undefined);
  let state = proposing("주문 문단 뒤");
  const prompt = buildPrompt(state, nextAction(state));
  assert.equal(data(prompt).placementNote, "주문 문단 뒤");
  assert.match(prompt, /placementNote\(사용자 위치 지시\)가 있으면 해당 위치를 우선/);
  state = transition(
    state,
    resultEvent({ id: "j", state, action: nextAction(state) }, JSON.stringify(plan)),
  ).state;
  state = send(state, "select_figures", { reviewedRevision: 1, figures: ["f1"] });
  assert.equal(data(buildPrompt(state, nextAction(state))).placementNote, "주문 문단 뒤");
});

// 묶음 판정은 장 상태만으로 정해진다 · 실행 없이 모든 갈래를 고정한다
test("ADR-0026 묶음 판정: 기다림·사람 조치·부분 결과·모두 실패·계약 위반", () => {
  const done = (id, got = id) => ({
    status: "completed",
    action: { figureId: id },
    event: { output: { figures: [{ id: got }] } },
  });
  const failed = (id) => ({ status: "failed", error: "멈춤", action: { figureId: id } });
  assert.equal(
    judgeBatch([done("f1"), { status: "running", action: { figureId: "f2" } }]).kind,
    "wait",
  );
  const attention = { status: "needs_attention", action: { figureId: "f2" } };
  assert.equal(judgeBatch([failed("f1"), attention]).from, attention);
  assert.deepEqual(judgeBatch([done("f1"), failed("f2"), done("f3", "f9")]), {
    kind: "result",
    figures: [{ id: "f1" }],
    failed: [
      { id: "f2", error: "멈춤" },
      { id: "f3", error: "그림 결과가 이 자리와 맞지 않습니다" },
    ],
  });
  assert.equal(judgeBatch([failed("f1"), done("f2", "f9")]).kind, "settle");
  assert.equal(judgeBatch([done("f1", "f9")]).kind, "invalid");
});
