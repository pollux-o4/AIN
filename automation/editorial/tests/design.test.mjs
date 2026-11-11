import assert from "node:assert/strict";
import test from "node:test";
import { designViewSchema } from "../../contracts/writing-modes.mjs";
import { transition } from "../domain/index.mjs";
import { runView } from "../service/view.mjs";

const diagnosis = {
  purpose: "설명",
  audience: "개발자",
  sectionModes: ["explain", "procedure"],
  preserveVoice: "의미 보존",
  strategy: "사례 설명",
  primaryMode: "explain",
  readerLevel: "beginner",
};
const outline = {
  sections: [
    "이전 문자열 구간",
    { title: "개념", mode: "explain", keyPoint: "책임 분리" },
    { title: "순서", mode: "procedure", keyPoint: "결제 확인" },
  ],
  rationale: "이해 후 적용",
};
function run(direction) {
  return {
    id: "design",
    ai: { model: "fixture" },
    startedAt: 1000,
    state: transition(null, {
      id: "start",
      actor: "user",
      type: "start",
      articleId: "design",
      idea: "글 설계",
      direction,
    }).state,
  };
}
function addArtifact(run, stage, output, revision = run.state.revision) {
  run.state.artifacts[stage] = { revision, output: structuredClone(output) };
}
function design(run) {
  const before = structuredClone(run);
  const projected = runView(run, 1000).design;
  assert.deepEqual(designViewSchema.parse(projected), projected);
  assert.deepEqual(run, before);
  return projected;
}

test("design leaves automatic choices unknown until current diagnosis exists", () => {
  const saved = run();
  const empty = { mode: null, modeBy: null, readerLevel: null, levelBy: null, sections: [] };
  assert.deepEqual(design(saved), empty);
  delete saved.state.direction;
  assert.deepEqual(design(saved), empty);
  const legacyDiagnosis = { ...diagnosis };
  delete legacyDiagnosis.primaryMode;
  delete legacyDiagnosis.readerLevel;
  addArtifact(saved, "diagnose", legacyDiagnosis);
  assert.deepEqual(design(saved), empty);
  addArtifact(saved, "diagnose", diagnosis);
  assert.deepEqual(design(saved), {
    mode: "explain",
    modeBy: "ai",
    readerLevel: "beginner",
    levelBy: "ai",
    sections: [],
  });
});

test("design resolves mode and reader level independently with user precedence", () => {
  for (const [direction, mode, modeBy, readerLevel, levelBy] of [
    [{ mode: "argue", readerLevel: "expert" }, "argue", "user", "expert", "user"],
    [{ mode: "narrate" }, "narrate", "user", "beginner", "ai"],
    [{ readerLevel: "intermediate" }, "explain", "ai", "intermediate", "user"],
    [{}, "explain", "ai", "beginner", "ai"],
  ]) {
    const saved = run(direction);
    addArtifact(saved, "diagnose", diagnosis);
    assert.deepEqual(design(saved), { mode, modeBy, readerLevel, levelBy, sections: [] });
  }
  const selected = run({ mode: "procedure", readerLevel: "expert" });
  assert.deepEqual(design(selected), {
    mode: "procedure",
    modeBy: "user",
    readerLevel: "expert",
    levelBy: "user",
    sections: [],
  });
});

test("design projects mixed outline sections and ignores stale or malformed AI artifacts", () => {
  const saved = run();
  addArtifact(saved, "diagnose", diagnosis);
  addArtifact(saved, "outline", outline);
  assert.deepEqual(design(saved).sections, [
    { title: "이전 문자열 구간", mode: null },
    { title: "개념", mode: "explain" },
    { title: "순서", mode: "procedure" },
  ]);
  saved.state.history.push(structuredClone(saved.state));
  saved.state.revision = 2;
  assert.deepEqual(design(saved), {
    mode: null,
    modeBy: null,
    readerLevel: null,
    levelBy: null,
    sections: [],
  });
  addArtifact(saved, "diagnose", { ...diagnosis, primaryMode: "unknown" });
  addArtifact(saved, "outline", { ...outline, sections: [{ title: "깨진 구간" }] });
  assert.deepEqual(design(saved).sections, []);
  assert.equal(design(saved).mode, null);
  saved.state.direction = { mode: "argue", readerLevel: "auto" };
  assert.equal(design(saved).mode, "argue");
  assert.equal(design(saved).modeBy, "user");
});
