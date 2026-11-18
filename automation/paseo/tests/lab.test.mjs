import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { labMatrix } from "../../contracts/lab.mjs";
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
