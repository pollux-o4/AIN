import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { figureOutputSchemas, svgIssue } from "../../contracts/figure.mjs";
import { actionRequestSchema } from "../../contracts/requests.mjs";
import { testScratch } from "../../runtime/scratch.mjs";
import { coverageGap } from "../domain/figures.mjs";
import { flowIssue, nextAction, placeFigures, STAGES, transition } from "../domain/index.mjs";
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
    },
    { anchor: "본문에 없는 문장입니다.", claim: "버려질 후보", reason: "이유", scene: "장면" },
    { anchor: ANCHOR, claim: "같은 문장 중복", reason: "이유", scene: "장면" },
    { anchor: ANCHOR2, claim: "결제 요청과 확인 순서", reason: "이유", scene: "장면" },
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
    units: ["글머리", "결제"],
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
  // 후보 집계(세기만): 단위 2곳(글머리·결제) 모두 후보 · 빠진 단위 없음
  assert.deepEqual(state.figure.coverage, {
    units: 2,
    withFigure: 2,
    skipped: 0,
    missing: [],
    candidates: 2,
  });
  state = send(state, "select_figures", { ...reviewed, figures: ["f2", "f1"] });
  assert.equal(state.status, "waiting_figure");
  // 그림 한 장이 작업 단위: f1의 초안 → 내용 → 시각, 그다음 f2 · 사람 확인은 모두 마친 뒤 한 번
  const step = () => nextAction(state);
  assert.deepEqual(
    [step().figureId, step().pass, step().candidates.map((c) => c.id), step().progress],
    ["f1", "draft", ["f1"], { index: 1, total: 2 }],
  );
  assert.throws(() => result(state, "figure", made(["f2"]), "draft"), /Missing figure/);
  const noted = (ids, notes) => ({
    figures: made(ids).figures.map((f) => ({ ...f, notes })),
  });
  state = result(state, "figure", noted(["f1"], "구도만 잡음"), "draft");
  assert.throws(() => result(state, "figure", made(["f1"]), "draft"), /stale/);
  assert.deepEqual(
    [step().figureId, step().pass, step().previous.map((f) => [f.id, f.notes])],
    ["f1", "content", [["f1", "구도만 잡음"]]],
  );
  // 다른 그림의 결과는 받지 않음
  assert.throws(
    () =>
      send(state, "figure_result", {
        stage: "figure",
        revision: 1,
        pass: "content",
        figureId: "f2",
        output: made(["f2"]),
      }),
    /stale/,
  );
  state = result(state, "figure", made(["f1"]), "content");
  state = result(state, "figure", noted(["f1"], "마감"), "visual");
  assert.equal(state.status, "waiting_figure");
  assert.deepEqual(
    [step().figureId, step().pass, step().previous, step().progress],
    ["f2", "draft", undefined, { index: 2, total: 2 }],
  );
  assert.deepEqual(
    state.figure.items.map((item) => [item.id, item.notes]),
    [["f1", undefined]],
  );
  for (const pass of ["draft", "content", "visual"])
    state = result(state, "figure", made(["f2"]), pass);
  // 준비됨 ≠ 확인됨: 사람 확인 전에는 발행 준비 승인 불가
  assert.equal(state.status, "awaiting_figure_review");
  assert.deepEqual(
    [state.figure.current, state.figure.draft, state.figure.items.map((item) => item.id)],
    [undefined, undefined, ["f1", "f2"]],
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

async function fixture(t) {
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
                action.stage === "figure_plan" ? plan : made(action.candidates.map((c) => c.id)),
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
  const service = new EditorialService({ store, jobs, dispatch: async () => {} });
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
  // 시각자료 선택·확인은 사람만
  await assert.rejects(() => f.act(id, "request_figures", {}, "agent"), { status: 403 });
  view = await f.act(id, "request_figures");
  assert.equal(view.status, "waiting_figure");
  assert.deepEqual(
    [view.canDownload, view.canFeedback, view.canAuthorizePublication, view.monitor.canPause],
    [true, false, false, true],
  );
  assert.deepEqual(
    view.monitor.pipeline.slice(-2).map((step) => [step.name, step.status]),
    [
      ["시각자료 제안", "active"],
      ["시각자료 생성", "pending"],
    ],
  );
  view = await f.drain(id);
  assert.equal(view.monitor.label, "시각자료 위치 선택 대기");
  assert.deepEqual(view.figure.candidates[1], {
    id: "f2",
    anchor: ANCHOR2,
    claim: "결제 요청과 확인 순서",
    section: "결제",
  });
  assert.deepEqual(
    [view.canSelectFigures, view.canConfirmFigures, view.canFeedback],
    [true, false, true],
  );
  assert.throws(() => s.figure(id, "f1"), { status: 404 });
  await assert.rejects(() => f.act(id, "select_figures", { figures: [] }), { status: 400 });
  await assert.rejects(() => f.act(id, "select_figures", { figures: ["f3"] }), { status: 409 });
  await f.act(id, "select_figures", { figures: ["f1", "f2"] });
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
  assert.match(s.figure(id, "f1").svg, /^<svg xmlns/);
  // 확인 전 그림은 내보내지 않음(준비됨 ≠ 확인됨)
  assert.doesNotMatch(s.export(id, { format: "html" }).body, /<figure/);
  view = await f.act(id, "confirm_figures", { figures: ["f1"] });
  assert.equal(view.monitor.label, "시각자료 확인됨");
  assert.deepEqual(
    view.figure.items.map((item) => item.id),
    ["f1"],
  );
  assert.deepEqual([view.canAuthorizePublication, view.canDiscardFigures], [true, true]);
  assert.throws(() => s.figure(id, "f2"), { status: 404 });
  assert.equal(s.download(id).text, txt);
  assert.equal(s.export(id, { format: "txt" }).body, txt);
  const html = s.export(id, { format: "html" }).body;
  assert.equal(html.match(/<figure/g)?.length, 1);
  assert.match(s.export(id, { format: "zip" }).body.toString("latin1"), /figures\/f1\.svg/);
  assert.throws(() => s.export(id, { format: "pdf" }), { status: 400 });
  // 실패한 f1 초안 층 1회 + 재개 뒤 (f1·f2) × (초안·내용·시각) 6회
  assert.deepEqual(f.calls, [...STAGES, "figure_plan", ...Array(7).fill("figure")]);
  assert.deepEqual(
    runPipeline(s.store.get(id))
      .slice(-2)
      .map((step) => step.status),
    ["done", "done"],
  );
  const labels = s.store.get(id).events.map((event) => event.label);
  for (const label of ["시각자료 위치 후보 준비됨", "시각자료 준비됨 · 확인 대기", "시각자료 확인"])
    assert.ok(labels.includes(label), label);
  view = await f.act(id, "authorize_publication");
  assert.equal(view.status, "publication_ready");
  assert.equal(view.canDiscardFigures, false);
  assert.equal(f.calls.length, STAGES.length + 8);
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
  const pending = (await (await get("")).json()).html;
  assert.equal(pending.replace(/<figure[\s\S]*?<\/figure>/, ""), plain);
  assert.match(
    pending,
    /그래서 둘을 나눕니다\.<\/p>\n<figure class="figure" data-figure="f1" data-pending="">/,
  );
  assert.match(
    pending,
    /<img src="\/write\/api\/runs\/[a-f0-9-]+\/figures\/f1\?v=\d+" alt="f1 설명"/,
  );
  assert.match(pending, /확인 전/);
  const file = await get("/figures/f1");
  assert.equal(file.status, 200);
  assert.match(file.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(file.headers.get("content-security-policy"), /default-src 'none'.*sandbox/);
  assert.match(await file.text(), /^<svg xmlns/);
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
