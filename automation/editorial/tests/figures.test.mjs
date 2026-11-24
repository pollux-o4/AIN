import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import {
  FIGURE_LIMITS,
  FIGURE_PASSES,
  figureOutputSchemas,
  svgIssue,
} from "../../contracts/figure.mjs";
import { actionRequestSchema } from "../../contracts/requests.mjs";
import { testScratch } from "../../runtime/scratch.mjs";
import { articleHtml } from "../article-html.mjs";
import { coverageGap, partActions } from "../domain/figures.mjs";
import {
  flowIssue,
  nextAction,
  placedFigures,
  placeFigures,
  STAGES,
  transition,
} from "../domain/index.mjs";
import { editorialHttp } from "../http.mjs";
import { runPipeline } from "../monitor.mjs";
import { EditorialService } from "../service.mjs";
import { EditorialStore } from "../store.mjs";

// FIGURE-001: 초안 확정 뒤 선택 단계 · 본문 불변 · 준비와 확인 구분 · AI는 fixture
const TEXT =
  "# 쇼핑몰 구조\n\n주문과 결제는 책임이 다릅니다. 그래서 둘을 나눕니다.\n\n## 결제\n\n결제는 요청과 확인 순서로 진행됩니다.\n\n```\n주문 -> 결제\n\n결제 -> 배송\n```\n\n배송은 결제 뒤에 시작합니다.";
const ANCHOR = "주문과 결제는 책임이 다릅니다.";
const ANCHOR2 = "결제는 요청과 확인 순서로 진행됩니다.";
const SVG = '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>';
const output = {
  diagnose: {
    purpose: "설명",
    audience: "입문자",
    sectionModes: ["explanation"],
    preserveVoice: "의미 보존",
    strategy: "사례",
  },
  topic: { problem: "책임", scope: "쇼핑몰" },
  audience: { reader: "입문자", intent: "이해" },
  value: { outcome: "판단", preserve: ["의미"] },
  research: { evidence: [], uncertainties: ["확인 필요"] },
  outline: { sections: ["주문", "결제"], rationale: "책임 순서" },
  draft: { text: TEXT, changeSummary: "초고" },
  review: { findings: [], preservationCheck: "유지" },
};
const plan = {
  candidates: [
    {
      anchor: ANCHOR,
      claim: "주문과 결제의 책임 경계",
      kind: "diagram",
      reason: "이유",
      scene: "장면",
      without: "주문과 결제의 책임 경계를 놓친다.",
    },
    { anchor: "본문에 없는 문장입니다.", claim: "버려질 후보", reason: "이유", scene: "장면" },
    { anchor: ANCHOR, claim: "같은 문장 중복", reason: "이유", scene: "장면" },
    {
      anchor: ANCHOR2,
      claim: "결제 요청과 확인 순서",
      reason: "이유",
      scene: "장면",
      kind: "scene",
      without: "요청과 확인의 진행 순서를 놓친다.",
    },
  ],
};
const made = (ids) => ({
  figures: ids.map((id) => ({ id, svg: SVG, alt: `${id} 설명`, caption: `${id} 캡션` })),
});
let seq = 0;
const send = (state, type, data = {}) =>
  transition(state, {
    id: `fig-${++seq}`,
    actor: ["complete", "figure_result", "fail"].includes(type) ? "adapter" : "user",
    type,
    expectedVersion: state?.version,
    ...data,
  }).state;
function satisfied() {
  let state = send(null, "start", { articleId: "figure-article", idea: "쇼핑몰 구조" });
  while (state.status === "waiting_ai")
    state = send(state, "complete", {
      stage: state.stage,
      revision: state.revision,
      output: output[state.stage],
    });
  return send(state, "satisfy", { reviewedRevision: 1 });
}
const result = (state, stage, out, pass) =>
  send(state, "figure_result", { stage, revision: 1, output: out, ...(pass ? { pass } : {}) });
const reviewed = { reviewedRevision: 1 };
// 구성 결과: 고른 자리마다 장면 하나 · ADR-0026
const designs = (ids, extra = {}) => ({
  designs: ids.map((id) => ({ id, scene: `${id} 장면`, analogy: `${id} 대상` })),
  ...extra,
});
// 고른 자리를 구성하고 승인해 생성으로 넘긴다
const approved = (state, ids) =>
  send(result(state, "figure_compose", designs(ids)), "approve_design", reviewed);

test("FIGURE-001 선택 단계: 확정 뒤에만 시작하고 본문·확정을 바꾸지 않는다", () => {
  let state = satisfied();
  const before = structuredClone(state.artifacts);
  assert.throws(() => send(state, "select_figures", { ...reviewed, figures: ["f1"] }));
  state = send(state, "request_figures", reviewed);
  assert.equal(state.status, "waiting_figure");
  assert.deepEqual(nextAction(state), {
    type: "request_figure",
    stage: "figure_plan",
    revision: 1,
    units: ["도입부", "결제"],
  });
  // 생성 결과를 위치 제안 자리에 넣을 수 없음 · 본문에 맞는 앵커가 하나도 없으면 거부
  assert.throws(() => result(state, "figure", made(["f1"])), /stale figure result/);
  assert.throws(
    () =>
      result(state, "figure_plan", {
        candidates: [{ anchor: "없는 문장", claim: "x", reason: "이유", scene: "장면" }],
      }),
    /No figure anchor/,
  );
  state = result(state, "figure_plan", plan);
  assert.equal(state.status, "awaiting_figure_choice");
  assert.deepEqual(
    state.figure.candidates.map((c) => [c.id, c.anchor]),
    [
      ["f1", ANCHOR],
      ["f2", ANCHOR2],
    ],
  );
  for (const figures of [[], ["f9"], ["f1", "f1"]])
    assert.throws(() => send(state, "select_figures", { ...reviewed, figures }));
  // 후보 집계(세기만): 단위 2곳(도입부·결제) 모두 후보 · 빠진 단위 없음
  assert.deepEqual(state.figure.coverage, {
    units: 2,
    withFigure: 2,
    skipped: 0,
    missing: [],
    candidates: 2,
  });
  // 사람이 고른 스타일은 구성 입력에 실리고 구성 결과보다 우선한다 · ADR-0027
  const picked = send(state, "select_figures", { ...reviewed, figures: ["f1"], look: "stick" });
  assert.equal(nextAction(picked).look, "stick");
  assert.equal(result(picked, "figure_compose", designs(["f1"])).figure.style.look, "stick");
  state = send(state, "select_figures", { ...reviewed, figures: ["f2", "f1"] });
  assert.equal(state.status, "waiting_figure");
  // 구성은 고른 자리 전부를 한 번에 · 생성 결과는 받지 않음 · 승인 전에는 생성하지 않음 · ADR-0026
  assert.deepEqual(
    [nextAction(state).stage, nextAction(state).candidates.map((c) => c.id)],
    ["figure_compose", ["f1", "f2"]],
  );
  assert.throws(() => result(state, "figure", made(["f1"]), "draw"), /stale/);
  assert.throws(() => result(state, "figure_compose", designs(["f1"])), /Missing design/);
  state = result(state, "figure_compose", designs(["f1", "f2"]));
  assert.equal(state.status, "awaiting_figure_design");
  state = send(state, "approve_design", reviewed);
  assert.equal(state.status, "waiting_figure");
  // 같은 층을 밟는 그림을 한 묶음으로: 그림마다 따로(parts) 동시에 · 사람 확인은 모두 마친 뒤 한 번 · ADR-0026
  const step = () => nextAction(state);
  const parts = () =>
    step().parts.map((part) => [part.figureId, part.candidates.map((c) => c.id), part.progress]);
  assert.deepEqual(
    [step().figureIds, step().pass, parts()],
    [
      ["f1", "f2"],
      "draw",
      [
        ["f1", ["f1"], { index: 1, total: 2 }],
        ["f2", ["f2"], { index: 2, total: 2 }],
      ],
    ],
  );
  // 묶음의 그림이 하나라도 빠진 결과는 받지 않음
  assert.throws(() => result(state, "figure", made(["f2"]), "draw"), /Missing figure/);
  const noted = (ids, notes) => ({
    figures: made(ids).figures.map((f) => ({ ...f, notes })),
  });
  // 중단·재개해도 같은 묶음 요청을 이어 감
  state = send(send(state, "pause"), "resume");
  assert.deepEqual([step().figureIds, step().pass], [["f1", "f2"], "draw"]);
  // 다른 묶음을 가리키는 결과는 받지 않음
  assert.throws(
    () =>
      send(state, "figure_result", {
        stage: "figure",
        revision: 1,
        pass: "draw",
        figureIds: ["f2"],
        output: made(["f2"]),
      }),
    /stale/,
  );
  state = result(state, "figure", noted(["f1", "f2"], "마감"), "draw");
  assert.throws(() => result(state, "figure", made(["f1", "f2"]), "draw"), /stale/);
  // 준비됨 ≠ 확인됨: 사람 확인 전에는 발행 준비 승인 불가
  assert.equal(state.status, "awaiting_figure_review");
  assert.deepEqual(
    [
      state.figure.current,
      state.figure.passDrafts,
      state.figure.items.map((item) => [item.id, item.notes]),
    ],
    [
      undefined,
      undefined,
      [
        ["f1", undefined],
        ["f2", undefined],
      ],
    ],
  );
  assert.throws(() => send(state, "authorize_publication", reviewed));
  state = send(state, "confirm_figures", { ...reviewed, figures: ["f2"] });
  assert.equal(state.status, "satisfied");
  assert.deepEqual(
    state.figure.items.map((item) => item.id),
    ["f2"],
  );
  assert.deepEqual(state.artifacts, before);
  assert.equal(state.satisfiedRevision, 1);
  assert.equal(flowIssue(state), null);
  assert.throws(() => send(state, "request_figures", reviewed));
  const ready = send(state, "authorize_publication", reviewed);
  assert.deepEqual(ready.approval.figures, ["f2"]);
  assert.throws(() => send(ready, "discard_figures", reviewed));
  // 글을 고치면 앵커가 무효: 시각자료는 이력에만 남고 확정·승인과 함께 무효
  const revised = send(ready, "feedback", { reviewedRevision: 1, feedback: "더 짧게" });
  assert.equal(revised.figure, undefined);
  assert.equal(revised.history.at(-1).figure.phase, "confirmed");
  assert.equal(revised.satisfiedRevision, null);
});

test("ADR-0017 위치 제안 집계: 빠진 단위·후보 한 개는 개선 신호로 센다", () => {
  let state = send(satisfied(), "request_figures", reviewed);
  state = result(state, "figure_plan", { candidates: [plan.candidates[0]] });
  assert.deepEqual(state.figure.coverage.missing, ["결제"]);
  assert.equal(coverageGap(state.figure.coverage), "검토하지 않은 단위 1곳");
  let skipped = send(satisfied(), "request_figures", reviewed);
  skipped = result(skipped, "figure_plan", {
    candidates: [plan.candidates[0]],
    skipped: [{ unit: "결제", reason: "순서가 한 문장뿐이다" }],
  });
  assert.equal(coverageGap(skipped.figure.coverage), null);
  assert.equal(
    coverageGap({ units: 5, withFigure: 1, skipped: 4, missing: [], candidates: 1 }),
    "단위 5곳 중 후보 1개",
  );
});

test("ADR-0022 일관성 계약: 공통 규칙과 두 후보 이상이 가리키는 반복 대상만 그 그림 작업에 넘긴다", () => {
  const style = { accent: " 주황 #f5a623 ", base: "남색 선 2px", labels: "12px 굵게" };
  const contract = {
    designs: [
      { id: "f1", scene: "장면", motifs: ["상자", "상자", "없는 대상"] },
      { id: "f2", scene: "장면", motifs: ["상자", "카드"] },
    ],
    world: " 한 창고 ",
    style,
    motifs: [
      { name: "상자", look: "갈색 종이 상자" },
      { name: "상자", look: "중복은 버림" },
      { name: "카드", look: "한 그림에만 나오면 계약에서 뺌" },
    ],
  };
  // 계약은 구성 단계가 고른 자리 전부를 보고 한 번 정한다 · ADR-0026
  let state = result(send(satisfied(), "request_figures", reviewed), "figure_plan", plan);
  state = send(state, "select_figures", { ...reviewed, figures: ["f1", "f2"] });
  state = result(state, "figure_compose", contract);
  assert.equal(state.figure.world, "한 창고");
  assert.deepEqual(state.figure.style, { ...style, accent: "주황 #f5a623" });
  assert.deepEqual(state.figure.motifs, [{ name: "상자", look: "갈색 종이 상자" }]);
  assert.deepEqual(
    state.figure.candidates.map((c) => c.motifs),
    [["상자"], ["상자", "카드"]],
  );
  state = send(state, "approve_design", reviewed);
  const action = nextAction(state);
  assert.deepEqual(
    [action.parts[0].style, action.parts[0].motifs, action.world],
    [state.figure.style, state.figure.motifs, "한 창고"],
  );
  // 계약 없는 구성도 그대로 진행
  const legacy = result(send(satisfied(), "request_figures", reviewed), "figure_plan", plan);
  const plain = nextAction(
    approved(send(legacy, "select_figures", { ...reviewed, figures: ["f1"] }), ["f1"]),
  );
  assert.deepEqual([plain.parts[0].style, plain.parts[0].motifs], [undefined, undefined]);
});

test("ADR-0023 후보별 방향: 고른 후보에만 저장하고 그 그림 작업에만 넘긴다", () => {
  let state = result(send(satisfied(), "request_figures", reviewed), "figure_plan", plan);
  state = send(state, "select_figures", {
    ...reviewed,
    figures: ["f1", "f2"],
    directions: { f1: "  좌우 비교 구도로  ", f2: "   " },
  });
  assert.deepEqual(
    state.figure.candidates.map((c) => c.direction),
    ["좌우 비교 구도로", undefined],
  );
  assert.equal(nextAction(state).candidates[0].direction, "좌우 비교 구도로");
  // 고르지 않은 후보의 방향은 저장하지 않음
  const other = result(send(satisfied(), "request_figures", reviewed), "figure_plan", plan);
  const picked = send(other, "select_figures", {
    ...reviewed,
    figures: ["f2"],
    directions: { f1: "버려질 방향" },
  });
  assert.equal(picked.figure.candidates[0].direction, undefined);
  const base = { operationId: "op", expectedVersion: 1, type: "select_figures", figures: ["f1"] };
  assert.equal(
    actionRequestSchema.safeParse({ ...base, directions: { f1: "방향" } }).success,
    true,
  );
  assert.equal(
    actionRequestSchema.safeParse({ ...base, directions: { f1: "가".repeat(301) } }).success,
    false,
  );
  assert.equal(
    actionRequestSchema.safeParse({ ...base, directions: { x: "방향" } }).success,
    false,
  );
});

test("FIGURE-001 시각자료 없이: 버리면 확정 상태로 돌아가고 승인은 본문만 대상", () => {
  let state = result(send(satisfied(), "request_figures", reviewed), "figure_plan", plan);
  state = send(state, "discard_figures", reviewed);
  assert.equal(state.status, "satisfied");
  assert.equal(state.figure, undefined);
  assert.deepEqual(send(state, "authorize_publication", reviewed).approval.figures, []);
  // 중단·실패는 시각자료 작업으로 복귀 · 조작된 상태는 계약 위반
  state = send(send(satisfied(), "request_figures", reviewed), "pause");
  assert.equal(flowIssue(state), null);
  assert.equal(send(state, "resume").status, "waiting_figure");
  const failed = send(send(satisfied(), "request_figures", reviewed), "fail", {
    stage: "review",
    revision: 1,
    error: "멈춤",
  });
  assert.equal(send(failed, "retry").status, "waiting_figure");
  assert.match(flowIssue({ ...satisfied(), status: "awaiting_figure_review" }), /figure work/);
  const tampered = result(send(satisfied(), "request_figures", reviewed), "figure_plan", plan);
  tampered.figure.candidates[0].anchor = "바뀐 문장";
  assert.match(flowIssue(tampered), /anchor to the current draft/);
});

test("FIGURE-001 배치: 앵커 문단 뒤에만 끼우고 본문 글자는 그대로", () => {
  const items = [
    { id: "f2", anchor: ANCHOR2 },
    { id: "f1", anchor: ANCHOR },
    { id: "f3", anchor: "주문 -> 결제" },
    { id: "f4", anchor: "없는 문장" },
  ];
  const parts = placeFigures(TEXT, items);
  assert.equal(parts.map((p) => p.text ?? "").join(""), TEXT);
  assert.deepEqual(
    parts.filter((p) => p.figure).map((p) => p.figure.id),
    ["f1", "f2", "f3"],
  );
  assert.ok(parts[0].text.endsWith("그래서 둘을 나눕니다."));
  // 코드 블록 안 문장은 블록이 끝난 뒤에 놓음
  assert.ok(parts[4].text.endsWith("```"));
});

test("FIGURE-001 위치 선택: 후보 자리를 같은 배치 규칙으로 본문에 표시하고 그림은 넣지 않음", () => {
  const candidates = [
    { id: "f1", anchor: ANCHOR },
    { id: "f2", anchor: ANCHOR2 },
  ];
  const view = {
    id: "r1",
    version: 1,
    title: "제목",
    text: TEXT,
    figure: { phase: "choose", candidates, items: [] },
  };
  const html = articleHtml(view);
  assert.deepEqual(
    [...html.matchAll(/data-candidate="(\w+)"/g)].map((m) => m[1]),
    ["f1", "f2"],
  );
  assert.doesNotMatch(html, /<figure/);
  const spots = (figure, busy = false) =>
    [
      ...articleHtml({ ...view, busy, figure: { ...view.figure, ...figure } }).matchAll(
        /data-(?:figure|spot)="(\w+)"/g,
      ),
    ].map((m) => m[1]);
  // 고른 자리는 그림이 생기기 전에도 확정 전까지 실제 상태로 남는다
  assert.deepEqual(spots({ phase: "design", selected: ["f2"] }), ["design"]);
  assert.deepEqual(spots({ phase: "compose", selected: ["f2"] }, true), ["composing"]);
  assert.deepEqual(spots({ phase: "compose", selected: ["f2"] }), ["stopped"]);
  const drawing = {
    phase: "generate",
    selected: ["f1", "f2"],
    current: { ids: ["f2"], pass: "draw" },
  };
  assert.deepEqual(spots({ ...drawing, items: [] }, true), ["queued", "drawing"]);
  const done = { ...drawing, items: [{ id: "f1", anchor: ANCHOR, alt: "a" }] };
  assert.deepEqual(spots(done, true), ["f1", "drawing"]);
  assert.deepEqual(spots({ ...done, phase: "confirmed" }), ["f1"]);
  assert.deepEqual(spots({ phase: "discarded", selected: ["f1"] }), []);
});

test("FIGURE-001 계약: 실행·외부 참조 SVG 거부, 네임스페이스 보충, 선택 id 검증", () => {
  for (const bad of [
    "<svg><script>alert(1)</script></svg>",
    '<svg onload="x()"></svg>',
    '<svg><image href="https://example.test/a.png"/></svg>',
    '<svg><a href="javascript:x"><text>a</text></a></svg>',
    "<svg><foreignObject/></svg>",
    '<svg><rect fill="url(https://example.test/x)"/></svg>',
    "<div></div>",
    "<svg></svg><svg></svg><p>",
  ])
    assert.ok(svgIssue(bad), bad);
  assert.equal(svgIssue('<svg><rect fill="url(#g)"/><use href="#a"/></svg>'), null);
  const parsed = figureOutputSchemas.figure.parse(made(["f1"]));
  assert.match(parsed.figures[0].svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox/);
  // 넘친 메모는 버리지 않고 앞부분을 다음 층에 넘김
  const [long] = made(["f1"]).figures;
  const kept = figureOutputSchemas.figure.parse({
    figures: [{ ...long, notes: "가".repeat(FIGURE_LIMITS.notes + 50) }],
  });
  assert.equal(kept.figures[0].notes.length, FIGURE_LIMITS.notes);
  assert.equal(
    figureOutputSchemas.figure.safeParse({ figures: [{ id: "f1", svg: "<svg", alt: "a" }] })
      .success,
    false,
  );
  const base = { operationId: "op", expectedVersion: 1 };
  assert.equal(actionRequestSchema.safeParse({ ...base, type: "select_figures" }).success, false);
  assert.equal(
    actionRequestSchema.safeParse({ ...base, type: "select_figures", figures: ["f1", "f1"] })
      .success,
    false,
  );
  assert.equal(
    actionRequestSchema.safeParse({ ...base, type: "select_figures", figures: ["f1"] }).success,
    true,
  );
  assert.equal(actionRequestSchema.safeParse({ ...base, type: "confirm_figures" }).success, true);
  assert.equal(actionRequestSchema.safeParse({ ...base, type: "request_figures" }).success, true);
});

async function fixture(t, options = {}) {
  const dir = await testScratch(t, "editorial-test");
  const store = new EditorialStore(join(dir, "state.sqlite"));
  t.after(() => store.close());
  const calls = [];
  const records = new Map();
  const jobs = {
    fail: false,
    async create({ state }) {
      const action = nextAction(state);
      calls.push(action.stage ?? action.type);
      const id = `job-${calls.length}`;
      const common = {
        id: `${id}-result`,
        actor: "adapter",
        expectedVersion: state.version,
        revision: state.revision,
      };
      const event =
        action.type === "request_figure"
          ? {
              ...common,
              type: "figure_result",
              stage: action.stage,
              ...(action.pass ? { pass: action.pass } : {}),
              output:
                action.stage === "figure_plan"
                  ? plan
                  : action.stage === "figure_compose"
                    ? designs(action.recompose ?? action.candidates.map((c) => c.id))
                    : made(action.figureIds),
            }
          : { ...common, type: "complete", stage: state.stage, output: output[state.stage] };
      records.set(id, { id, event });
      return { id };
    },
    async poll(id) {
      return jobs.fail
        ? { id, status: "failed", failureKind: "invalid_output" }
        : { ...records.get(id), status: "completed" };
    },
    async describe() {
      return null;
    },
  };
  const service = new EditorialService({
    store,
    jobs,
    dispatch: async () => {},
    ...(options.figureRoutes ? { figureRoutes: options.figureRoutes } : {}),
  });
  const act = (id, type, extra = {}, actor = "user") =>
    service.action(
      id,
      { operationId: `op-${++seq}`, type, expectedVersion: service.get(id).version, ...extra },
      actor,
    );
  const drain = async (id) => {
    for (let i = 0; i < 12; i++) if (!(await service.advance(id)).continue) return service.get(id);
    throw new Error("Did not settle");
  };
  const run = await service.create({ requestId: `figure-${++seq}`, idea: "쇼핑몰 구조" });
  await drain(run.id);
  await act(run.id, "satisfy");
  return { service, jobs, calls, act, drain, id: run.id };
}

test("FIGURE-001 서비스: 제안 AI 1회·생성은 그림 수 × 층 수, 실제 준비·확인만 표시, 본문 다운로드 불변", async (t) => {
  const f = await fixture(t);
  const { service: s, id } = f;
  const txt = s.download(id).text;
  let view = s.get(id);
  assert.equal(view.monitor.label, "초안 확정");
  assert.deepEqual(
    [view.canRequestFigures, view.canAuthorizePublication, view.figure],
    [true, true, null],
  );
  // 시각자료 확정은 사람만 · 위치 제안 요청 같은 지시는 에이전트도
  await assert.rejects(() => f.act(id, "confirm_figures", {}, "agent"), { status: 403 });
  view = await f.act(id, "request_figures");
  assert.equal(view.status, "waiting_figure");
  assert.deepEqual(
    [view.canDownload, view.canFeedback, view.canAuthorizePublication, view.monitor.canPause],
    [true, false, false, true],
  );
  assert.deepEqual(
    view.monitor.pipeline.slice(-3).map((step) => [step.name, step.status]),
    [
      ["시각자료 위치 제안", "active"],
      ["시각자료 구성", "pending"],
      ["시각자료 생성", "pending"],
    ],
  );
  view = await f.drain(id);
  assert.equal(view.monitor.label, "시각자료 위치 선택 대기");
  assert.deepEqual(view.figure.routesAvailable, ["svg"]);
  assert.deepEqual(
    view.figure.candidates.map(({ id, without, route, routeBy }) => ({
      id,
      without,
      route,
      routeBy,
    })),
    [
      { id: "f1", without: "주문과 결제의 책임 경계를 놓친다.", route: "svg", routeBy: "default" },
      {
        id: "f2",
        without: "요청과 확인의 진행 순서를 놓친다.",
        route: "image",
        routeBy: "default",
      },
    ],
  );
  assert.deepEqual(view.figure.candidates[1], {
    id: "f2",
    anchor: ANCHOR2,
    claim: "결제 요청과 확인 순서",
    // 위치 선정은 자리·관계만 · 장면·비유는 구성 단계가 채운다 · ADR-0026
    reason: "이유",
    scene: null,
    analogy: null,
    kind: "scene",
    motifs: [],
    mapping: [],
    without: "요청과 확인의 진행 순서를 놓친다.",
    route: "image",
    routeBy: "default",
    direction: null,
    section: "결제",
  });
  assert.deepEqual(
    [view.canSelectFigures, view.canConfirmFigures, view.canFeedback],
    [true, false, true],
  );
  assert.throws(() => s.figure(id, "f1"), { status: 404 });
  await assert.rejects(() => f.act(id, "select_figures", { figures: [] }), { status: 400 });
  await assert.rejects(() => f.act(id, "select_figures", { figures: ["f3"] }), { status: 409 });
  await assert.rejects(
    () => f.act(id, "select_figures", { figures: ["f2"] }),
    (error) => error.status === 409 && error.message === "이미지 경로가 아직 연결되지 않았습니다.",
  );
  await assert.rejects(
    () => f.act(id, "select_figures", { figures: ["f1"], routes: { f1: "image" } }),
    (error) => error.status === 409 && error.message === "이미지 경로가 아직 연결되지 않았습니다.",
  );
  await assert.rejects(
    () => f.act(id, "select_figures", { figures: ["f1"], routes: { f1: "png" } }),
    { status: 400 },
  );
  await assert.rejects(
    () => f.act(id, "select_figures", { figures: ["f1"], directions: { f1: "가".repeat(301) } }),
    { status: 400 },
  );
  view = await f.act(id, "select_figures", {
    figures: ["f1", "f2"],
    directions: { f2: "확대해서" },
    routes: { f2: "svg" },
  });
  assert.deepEqual(
    view.figure.candidates.map((c) => c.direction),
    [null, "확대해서"],
  );
  assert.deepEqual(
    view.figure.candidates.map(({ route, routeBy }) => [route, routeBy]),
    [
      ["svg", "default"],
      ["svg", "user"],
    ],
  );
  // 구성 결과를 사람이 승인해야 생성 · 의견을 주면 다시 구성 · ADR-0026
  view = await f.drain(id);
  assert.deepEqual(
    [view.monitor.label, view.canApproveDesign, view.figure.candidates[1].scene],
    ["시각자료 구성 확인 대기", true, "f2 장면"],
  );
  // 구성 승인은 지시라 에이전트도 · 결과물을 버리는 것은 수락과 같이 사람만
  await assert.rejects(() => f.act(id, "discard_figures", {}, "agent"), { status: 403 });
  await assert.rejects(() => f.act(id, "revise_design", { feedback: " " }), { status: 400 });
  view = await f.act(id, "revise_design", { feedback: "같은 창고 안 장면으로", figures: ["f2"] });
  assert.deepEqual([view.status, view.figure.recompose], ["waiting_figure", ["f2"]]);
  view = await f.drain(id);
  view = await f.act(id, "approve_design");
  // 생성 실패는 준비됨으로 표시하지 않음 · 명시적 재시도 뒤에만 다시 호출
  f.jobs.fail = true;
  view = await f.drain(id);
  assert.equal(view.status, "failed");
  assert.match(view.issue, /시각자료 생성 단계에서 멈춤/);
  assert.equal(view.monitor.pipeline.at(-1).status, "failed");
  assert.equal(view.canConfirmFigures, false);
  f.jobs.fail = false;
  await f.act(id, "resume");
  view = await f.drain(id);
  assert.equal(view.monitor.label, "시각자료 확인 대기");
  assert.deepEqual([view.canConfirmFigures, view.canAuthorizePublication], [true, false]);
  assert.equal(JSON.stringify(view).includes("<svg"), false);
  const figureFile = s.figure(id, "f1");
  assert.equal(figureFile.mime, "image/svg+xml");
  assert.match(figureFile.filename, /\.svg$/);
  assert.equal(figureFile.body, s.store.get(id).state.figure.items[0].svg);
  assert.match(figureFile.body, /^<svg xmlns/);
  // 확인 전 그림은 내보내지 않음(준비됨 ≠ 확인됨)
  assert.doesNotMatch(s.export(id, { format: "html" }).body, /<figure/);
  view = await f.act(id, "confirm_figures", { figures: ["f1"] });
  assert.equal(view.monitor.label, "시각자료 확인됨");
  assert.deepEqual(
    view.figure.items.map((item) => item.id),
    ["f1"],
  );
  assert.deepEqual(
    (({ route, mime, motion, labels }) => ({ route, mime, motion, labels }))(view.figure.items[0]),
    { route: "svg", mime: "image/svg+xml", motion: false, labels: [] },
  );
  assert.deepEqual([view.canAuthorizePublication, view.canDiscardFigures], [true, true]);
  assert.throws(() => s.figure(id, "f2"), { status: 404 });
  assert.equal(s.download(id).text, txt);
  assert.equal(s.export(id, { format: "txt" }).body, txt);
  const html = s.export(id, { format: "html" }).body;
  assert.equal(html.match(/<figure/g)?.length, 1);
  assert.match(s.export(id, { format: "zip" }).body.toString("latin1"), /figures\/f1\.svg/);
  assert.throws(() => s.export(id, { format: "pdf" }), { status: 400 });
  // 구성 2회(처음·f2 다시) + 실패한 초안 층 1회 + 재개 뒤 층 수(한 층은 f1·f2를 동시에 그리는 한 번) · ADR-0026
  assert.deepEqual(f.calls, [
    ...STAGES,
    "figure_plan",
    "figure_compose",
    "figure_compose",
    ...Array(1 + FIGURE_PASSES.length).fill("figure"),
  ]);
  assert.deepEqual(
    runPipeline(s.store.get(id))
      .slice(-3)
      .map((step) => step.status),
    ["done", "done", "done"],
  );
  const labels = s.store.get(id).events.map((event) => event.label);
  for (const label of [
    "시각자료 위치 후보 준비됨",
    "시각자료 구성 준비됨 · 확인 대기",
    "시각자료 구성 다시 요청",
    "시각자료 구성 승인",
    "시각자료 준비됨 · 확인 대기",
    "시각자료 확인",
  ])
    assert.ok(labels.includes(label), label);
  view = await f.act(id, "authorize_publication");
  assert.equal(view.status, "publication_ready");
  assert.equal(view.canDiscardFigures, false);
  assert.equal(f.calls.length, STAGES.length + 4 + FIGURE_PASSES.length);
});

test("FIGURE-001 화면 전달: 본문 HTML에 시각자료만 끼우고 SVG는 격리된 파일로 제공", async (t) => {
  const f = await fixture(t);
  const route = editorialHttp({
    service: f.service,
    token: "fixture-token-long-enough-not-a-real-secret",
  });
  const server = createServer(async (req, res) => {
    if (!(await route(req, res))) res.writeHead(404).end();
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cookie = (await fetch(`${origin}/write/session`)).headers.getSetCookie()[0].split(";")[0];
  const get = (path) => fetch(`${origin}/write/api/runs/${f.id}${path}`, { headers: { cookie } });
  const plain = (await (await get("")).json()).html;
  assert.equal(plain.includes("<figure"), false);
  await f.act(f.id, "request_figures");
  await f.drain(f.id);
  await f.act(f.id, "select_figures", { figures: ["f1"] });
  await f.drain(f.id);
  await f.act(f.id, "approve_design");
  await f.drain(f.id);
  const pending = (await (await get("")).json()).html;
  assert.equal(pending.replace(/<figure[\s\S]*?<\/figure>/, ""), plain);
  assert.match(
    pending,
    /그래서 둘을 나눕니다\.<\/p>\n<figure class="figure" data-figure="f1" data-pending="">/,
  );
  assert.match(
    pending,
    /<img src="\/write\/api\/runs\/[a-f0-9-]+\/figures\/f1\?v=\d+&amp;motion=static" data-motion="\/write\/api\/runs\/[a-f0-9-]+\/figures\/f1\?v=\d+" alt="f1 설명"/,
  );
  assert.match(pending, /확인 전/);
  const file = await get("/figures/f1");
  assert.equal(file.status, 200);
  assert.match(file.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(file.headers.get("content-security-policy"), /default-src 'none'.*sandbox/);
  const servedSvg = await file.text();
  assert.match(servedSvg, /^<svg xmlns/);
  assert.equal(servedSvg, f.service.figure(f.id, "f1").body);
  assert.equal(file.headers.get("cache-control"), "no-store");
  const versioned = await get("/figures/f1?v=1&motion=static");
  assert.match(versioned.headers.get("cache-control"), /immutable/);
  assert.match(
    (await get("/figures/f1?download")).headers.get("content-disposition"),
    /figure-.*-r1-f1\.svg/,
  );
  assert.equal((await get("/figures/f2")).status, 404);
  assert.equal((await fetch(`${origin}/write/api/runs/${f.id}/figures/f1`)).status, 401);
  await f.act(f.id, "confirm_figures");
  const confirmed = (await (await get("")).json()).html;
  assert.equal(confirmed.includes("확인 전"), false);
  assert.match(confirmed, /<figure class="figure" data-figure="f1">/);
});

// 만드는 중에도 본문에 놓인 다 만든 그림은 파일을 제공해야 깨진 그림으로 보이지 않음
test("generate phase serves finished figures only", () => {
  const items = [{ id: "f1", svg: "<svg/>" }];
  assert.deepEqual(
    placedFigures({ figure: { phase: "generate", items, selected: ["f1"], candidates: [] } }),
    items,
  );
  assert.deepEqual(placedFigures({ figure: { phase: "choose", items } }), []);
  assert.deepEqual(placedFigures({ figure: { phase: "discarded", items } }), []);
});

test("ADR-0025 서비스 설정: image 경로가 활성화되면 기본 image 후보를 선택할 수 있다", async (t) => {
  const f = await fixture(t, { figureRoutes: ["svg", "image"] });
  await f.act(f.id, "request_figures");
  let view = await f.drain(f.id);
  assert.deepEqual(view.figure.routesAvailable, ["svg", "image"]);
  view = await f.act(f.id, "select_figures", { figures: ["f2"] });
  assert.equal(view.figure.candidates.find((candidate) => candidate.id === "f2").route, "image");
  assert.equal(
    view.figure.candidates.find((candidate) => candidate.id === "f2").routeBy,
    "default",
  );
});

test("ADR-0026 확인 뒤 되돌림: 구성으로 보내면 그 자리만 다시 구성하고 세계·계약은 유지, 수정으로 보내면 직전 그림에서 지적만 고치고 3회까지 받는다", () => {
  let state = result(send(satisfied(), "request_figures", reviewed), "figure_plan", plan);
  state = send(state, "select_figures", { ...reviewed, figures: ["f1", "f2"] });
  const style = { accent: "주황", base: "선", labels: "12px" };
  state = result(
    state,
    "figure_compose",
    designs(["f1", "f2"], { world: "창고", style, motifs: [{ name: "상자", look: "갈색" }] }),
  );
  state = send(state, "approve_design", reviewed);
  for (const pass of FIGURE_PASSES) state = result(state, "figure", made(["f1", "f2"]), pass);
  assert.equal(state.status, "awaiting_figure_review");
  const bad = { ...reviewed, figures: ["f2"], feedback: "장면이 틀렸다" };
  assert.throws(() => send(state, "revise_figures", { ...bad, target: "elsewhere" }));
  assert.throws(() => send(state, "revise_figures", { ...bad, feedback: " ", target: "compose" }));
  // 무엇을 그릴지: f2만 다시 구성 · 다른 자리 구성과 세계·계약은 그대로 넘긴다
  const recomposed = send(state, "revise_figures", { ...bad, target: "compose" });
  const action = nextAction(recomposed);
  assert.deepEqual(
    [action.stage, action.recompose, action.world, action.style, action.feedback],
    ["figure_compose", ["f2"], "창고", style, "장면이 틀렸다"],
  );
  assert.deepEqual(
    action.candidates.map((c) => [c.id, c.scene]),
    [
      ["f1", "f1 장면"],
      ["f2", undefined],
    ],
  );
  assert.deepEqual(
    recomposed.figure.items.map((item) => item.id),
    ["f1"],
  );
  let again = result(recomposed, "figure_compose", designs(["f2"]));
  assert.deepEqual([again.status, again.figure.world], ["awaiting_figure_design", "창고"]);
  again = send(again, "approve_design", reviewed);
  assert.deepEqual([nextAction(again).figureIds, nextAction(again).pass], [["f2"], "draw"]);
  // 어떻게 그렸는지: 직전 그림과 지적을 넘겨 한 층만 고친다
  const fix = (from, id = "f1") =>
    send(from, "revise_figures", {
      ...reviewed,
      figures: [id],
      feedback: "선이 어긋났다",
      target: "fix",
    });
  assert.throws(() =>
    send(state, "revise_figures", {
      ...reviewed,
      figures: ["f1", "f2"],
      feedback: "x",
      target: "fix",
    }),
  );
  let done = state;
  for (let round = 1; round <= FIGURE_LIMITS.fixes; round += 1) {
    const fixing = fix(done);
    const [act] = partActions(nextAction(fixing));
    assert.deepEqual(
      [
        act.figureId,
        act.pass,
        act.previous[0].id,
        act.candidates[0].fix,
        fixing.figure.candidates[0].fixes,
      ],
      ["f1", "fix", "f1", "선이 어긋났다", round],
    );
    done = result(fixing, "figure", made(["f1"]), "fix");
    assert.deepEqual(
      [done.status, done.figure.items.map((item) => item.id)],
      ["awaiting_figure_review", ["f1", "f2"]],
    );
  }
  assert.throws(() => fix(done), /fix limit/);
  assert.deepEqual(nextAction(fix(done, "f2")).figureIds, ["f2"]);
});
