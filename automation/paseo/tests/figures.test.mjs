import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { stageOutputExamples } from "../../contracts/ai-output.mjs";
import { nextAction, transition } from "../../editorial/domain/index.mjs";
import { Jobs } from "../jobs.mjs";
import { buildPrompt, promptData } from "../prompts/index.mjs";
import { resultEvent } from "../results.mjs";
import { roleOf } from "../roles.mjs";

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
  action = nextAction(state);
  prompt = buildPrompt(state, action);
  assert.deepEqual(data(prompt).candidates, [
    {
      id: "f1",
      anchor: ANCHOR,
      claim: "책임 경계",
      reason: "이유",
      scene: "장면",
      kind: "diagram",
    },
  ]);
  assert.match(prompt, /script·foreignObject/);
  const job = { id: "job2", state, action };
  // 실행 가능한 SVG·형식 위반은 결과로 인정하지 않음
  assert.throws(() =>
    resultEvent(
      job,
      JSON.stringify({ figures: [{ id: "f1", svg: "<svg><script/></svg>", alt: "a" }] }),
    ),
  );
  // 층마다 역할 지시가 다르고, 앞 층 결과는 svgFile로 이어받는다
  assert.match(prompt, /역할은 초안 담당이다[\s\S]*움직임 요소 사용을 금지한다/);
  const out = JSON.stringify({ figures: [{ id: "f1", svg: SVG, alt: "설명", notes: "구도" }] });
  state = transition(state, resultEvent(job, out)).state;
  assert.equal(state.status, "waiting_figure");
  for (const [pass, role] of [
    ["content", /역할은 내용 편집자이다[\s\S]*판정[\s\S]*구도부터 새로 그린다/],
    ["visual", /역할은 시각 마감 담당이다[\s\S]*형태부터 다시 그린다[\s\S]*prefers-reduced-motion/],
  ]) {
    action = nextAction(state);
    assert.equal(action.pass, pass);
    const previous = action.previous.map(({ svg: _svg, ...rest }) => ({
      ...rest,
      svgFile: `/work/input-${rest.id}.svg`,
    }));
    prompt = buildPrompt(state, { ...action, previous });
    assert.match(prompt, role);
    assert.equal(data(prompt).previous[0].svgFile, "/work/input-f1.svg");
    state = transition(state, resultEvent({ id: `job-${pass}`, state, action }, out)).state;
  }
  assert.equal(state.status, "awaiting_figure_review");
});

test("FIGURE-001 작업: 시각자료 요청은 담당 세션 하나 · 본문에 없는 앵커는 실패로 남김", async () => {
  const base = resolve(".local/paseo-tests");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "run-"));
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
