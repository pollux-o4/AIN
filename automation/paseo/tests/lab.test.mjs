import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { labMatrix } from "../../contracts/lab.mjs";
import { flowIssue, STAGES, transition } from "../../editorial/domain/index.mjs";
import { EditorialStore } from "../../editorial/index.mjs";
import { labRuntime, seedFromArticle } from "../lab/seed.mjs";
import { judgeLabRecord, readLab, writeLabIndex, writeLabRecord } from "../lab/store.mjs";

const VARIANTS = [
  { id: "res010", label: "A", hypothesis: "", changes: [] },
  { id: "baseline", label: "현재", hypothesis: "", changes: [] },
];
const record = (over) => ({
  case: "algo-f3",
  variant: "baseline",
  trial: 1,
  stage: "figure",
  at: "2026-11-19T00:00:00.000Z",
  ref: null,
  model: null,
  ms: 1000,
  tokens: { input: 10, output: 2 },
  visual: null,
  verdict: null,
  ...over,
});

test("lab_001 기록을 쓰고 읽어 사례×변형 표로 묶으며 기준 변형이 첫 열이다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lab-"));
  const svg = join(root, "src.svg");
  await writeFile(svg, "<svg/>");
  await writeLabRecord(root, record({}), [
    { from: svg, path: "figure.svg", mime: "image/svg+xml" },
  ]);
  await writeLabRecord(root, record({ variant: "res010", ms: 3000 }));
  await writeLabRecord(root, record({ variant: "res010", trial: 2, ms: 1000 }));
  await writeLabRecord(root, record({ variant: "res010", trial: 3, ms: 2000 }));
  assert.equal(
    await readFile(join(root, "algo-f3/baseline/figure-1/figure.svg"), "utf8"),
    "<svg/>",
  );

  const { variants, rows } = labMatrix(await readLab(root, VARIANTS));
  assert.deepEqual(
    variants.map((v) => v.id),
    ["baseline", "res010"],
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(
    rows[0].cells.map((c) => [c.variant, c.summary.trials, c.summary.ms]),
    [
      ["baseline", 1, 1000],
      ["res010", 3, 2000],
    ],
  );
});

test("lab_002 판정은 해당 회차에만 붙고 집계에 반영되며 잘못된 기록은 거부한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lab-"));
  await writeLabRecord(root, record({}));
  await writeLabRecord(root, record({ trial: 2 }));
  await judgeLabRecord(
    root,
    { case: "algo-f3", variant: "baseline", stage: "figure", trial: 2 },
    {
      by: "사람",
      pass: true,
      note: "",
    },
  );
  const lab = await writeLabIndex(root, VARIANTS);
  const cell = labMatrix(lab).rows[0].cells[0];
  assert.deepEqual([cell.summary.passed, cell.summary.judged], [1, 1]);
  assert.equal(JSON.parse(await readFile(join(root, "lab.json"), "utf8")).records.length, 2);
  await assert.rejects(writeLabRecord(root, record({ case: "../escape" })));
  await assert.rejects(writeLabRecord(root, record({}), [{ from: "x", path: "../x", mime: "a" }]));
});

test("lab_003 목록에 없는 변형의 기록도 열로 드러난다", () => {
  const { variants } = labMatrix({ variants: VARIANTS, records: [record({ variant: "b-try" })] });
  assert.deepEqual(
    variants.map((v) => v.id),
    ["baseline", "res010", "b-try"],
  );
});

test("lab_004 변형은 대상 정책 두 줄만 다르고(단일 변수) 알 수 없는 변형은 멈춘다", async () => {
  const { figureSpec } = await import("../prompts/figure.mjs");
  const { LAB_VARIANTS, objectPolicy } = await import("../lab/variants.mjs");
  const flat = (spec) => [
    spec.task,
    ...(spec.steps ?? []),
    ...(spec.rules ?? []),
    ...spec.criteria,
  ];
  const actions = [{ stage: "figure_compose" }, { stage: "figure", pass: "draft" }];
  const base = actions.map((a) => flat(figureSpec(a, objectPolicy("baseline"))));
  for (const variant of LAB_VARIANTS.filter((v) => v.id !== "baseline")) {
    const lines = actions.map((a) => flat(figureSpec(a, variant.policy)));
    const changed = lines.flatMap((spec, i) => spec.filter((line, j) => line !== base[i][j]));
    assert.ok(changed.length >= 1, variant.id);
    for (const line of changed)
      assert.ok(
        line.includes(variant.policy.plan) ||
          line === variant.policy.check ||
          line === variant.policy.draw,
        line,
      );
    assert.equal(lines[0].length, base[0].length);
  }
  assert.throws(() => objectPolicy("nope"), /Unknown lab variant/);
});

test("lab_005 원본 글에서 확정 초안 또는 위치 후보 상태를 시드한다", () => {
  const runtimeDir = mkdtempSync(join(tmpdir(), "lab-seed-"));
  const outputs = {
    diagnose: {
      purpose: "설명",
      audience: "개발자",
      sectionModes: ["explanation"],
      preserveVoice: "의미 보존",
      strategy: "경험과 판단",
    },
    topic: { problem: "문제", scope: "범위" },
    audience: { reader: "개발자", intent: "이해" },
    value: { outcome: "판단", preserve: ["조건"] },
    research: { evidence: [], uncertainties: ["확인 필요"] },
    outline: { sections: ["배경", "결과"], rationale: "순서" },
    draft: { text: "# 초안\n\n확정된 초안입니다.", changeSummary: "초안" },
    review: { findings: [], preservationCheck: "유지" },
  };
  const step = (state, event) =>
    transition(state, { expectedVersion: state?.version, ...event }).state;
  let state = step(null, {
    id: "s",
    actor: "user",
    type: "start",
    articleId: "source-article-123",
    idea: "seed test",
  });
  for (const stage of STAGES)
    state = step(state, {
      id: stage,
      actor: "adapter",
      type: "complete",
      revision: state.revision,
      stage,
      output: outputs[stage],
    });
  state = step(state, { id: "ok", actor: "user", type: "satisfy", reviewedRevision: 1 });
  state = step(state, { id: "rf", actor: "user", type: "request_figures", reviewedRevision: 1 });
  state = step(state, {
    id: "plan",
    actor: "adapter",
    type: "figure_result",
    stage: "figure_plan",
    revision: 1,
    output: { candidates: [{ anchor: "확정된 초안입니다.", claim: "관계", reason: "이유" }] },
  });
  const store = new EditorialStore(join(runtimeDir, "editorial.sqlite"));
  store.save({ id: "source-article-123", requestId: "src", state, events: [] });
  store.close();

  const seeded = (from) => {
    const { articleId } = seedFromArticle({
      runtimeDir,
      sourceDir: runtimeDir,
      fromArticle: "source-article",
      from,
    });
    const reader = new EditorialStore(join(runtimeDir, "editorial.sqlite"));
    try {
      return reader.get(articleId).state;
    } finally {
      reader.close();
    }
  };
  const fresh = seeded("satisfied");
  assert.deepEqual([fresh.status, fresh.figure, flowIssue(fresh)], ["satisfied", undefined, null]);
  assert.equal(fresh.artifacts.draft.output.text, outputs.draft.text);
  // 구성 실험: 모든 회차가 같은 위치 후보에서 출발 · ADR-0026
  const choice = seeded("choice");
  assert.deepEqual(
    [choice.status, choice.figure.phase, choice.figure.candidates.map((c) => c.id)],
    ["awaiting_figure_choice", "choose", ["f1"]],
  );
  assert.throws(
    () => seedFromArticle({ runtimeDir, sourceDir: runtimeDir, fromArticle: "nope" }),
    /하나로 찾지 못했습니다/,
  );
});

// 실험 복제본이 실사용 "내 글"에 쌓이지 않도록 실사용 저장소 지정은 거부
test("LAB-001 연구소는 실사용 저장소를 쓰지 않는다", () => {
  assert.throws(() => labRuntime(".local/ai-runtime"), /실사용 저장소/);
  assert.match(labRuntime(".local/figure-lab/runtime"), /figure-lab\/runtime$/);
});
