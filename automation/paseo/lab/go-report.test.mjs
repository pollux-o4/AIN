import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importGoReport } from "./go-report.mjs";

test("Go lab report uses only confirmed operations and preserves unknown usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "ain-go-lab-report-"));
  const svg = '<svg viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>';
  const from = 1_700_000_000_000;
  const report = {
    lab: { variant: "metaphor", model: "fixture-model" },
    figure: {
      world: "합성 배경",
      candidates: [
        { id: "f1", anchor: "**합성 문장**", scene: "합성 장면", analogy: "합성 비유" },
        { id: "f2", anchor: "두 번째 문장" },
      ],
      selected: ["f1"],
      items: [{ id: "f1", svg }],
    },
    events: [
      { kind: "ai_requested", stage: "figure_plan", jobId: "plan", at: from },
      { kind: "ai_completed", stage: "figure_plan", jobId: "plan", at: from + 3 },
      { kind: "ai_requested", stage: "figure_compose", jobId: "compose", at: from + 10 },
      {
        kind: "ai_completed",
        stage: "figure_compose",
        jobId: "compose",
        at: from + 15,
        usage: { inputTokens: 3, outputTokens: 7 },
      },
      { kind: "ai_requested", stage: "figure", jobId: "draw", at: from + 20 },
      { kind: "ai_completed", stage: "figure", jobId: "draw", at: from + 29 },
    ],
    layers: [
      { parent: "unconfirmed", figure: "f1" },
      { parent: "draw", figure: "f1", usage: { inputTokens: 0, outputTokens: 0 } },
    ],
  };
  try {
    await assert.rejects(
      importGoReport({ report, caseId: "fixture", variant: "baseline", trial: 1, root }),
      /변형/,
    );
    const [plan, compose, draw] = await importGoReport({
      report,
      caseId: "fixture",
      variant: "metaphor",
      trial: 1,
      root,
    });
    assert.deepEqual([plan.ms, plan.tokens, plan.candidates.length], [3, null, 2]);
    assert.deepEqual(
      [compose.ms, compose.tokens, compose.candidates.length],
      [5, { input: 3, output: 7 }, 1],
    );
    assert.deepEqual(
      [draw.model, draw.ms, draw.note, draw.tokens],
      ["fixture-model", null, "층 1회", { input: 0, output: 0 }],
    );
    assert.equal(
      await readFile(join(root, "fixture-f1", "metaphor", "figure-1", "figure.svg"), "utf8"),
      svg,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("non-interactive launch stops at consent before accessing paths", () => {
  const run = fileURLToPath(new URL("./run.mjs", import.meta.url));
  const child = spawnSync(
    process.execPath,
    [run, "--from", "fixture", "--case", "fixture", "--variant", "baseline"],
    {
      env: { ...process.env, AIN_LIVE: "", AIN_DATA_DIR: "/intentionally-missing-lab-fixture" },
      input: "",
      encoding: "utf8",
    },
  );
  assert.equal(child.status, 2, child.stderr);
  assert.match(child.stderr, /AIN_LIVE=1/);
});
