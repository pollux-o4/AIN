import assert from "node:assert/strict";
import test from "node:test";
import { READER_LEVELS, WRITING_MODES } from "../../contracts/writing-modes.mjs";
import { BASE, LEVEL_RULES, MODE_RULES, resolveDirection, seasoningRules } from "../seasoning.mjs";

test("FLOW-002: user choices override diagnosis independently and section modes form an ordered union", () => {
  const state = {
    direction: { mode: "argue", readerLevel: "expert" },
    artifacts: {
      diagnose: { output: { primaryMode: "explain", readerLevel: "beginner" } },
      outline: {
        output: {
          sections: [
            { mode: "narrate" },
            { mode: "procedure" },
            { mode: "argue" },
            { mode: "narrate" },
            "기존 문자열 구간",
          ],
        },
      },
    },
  };
  const before = structuredClone(state);
  assert.deepEqual(resolveDirection(state), {
    modes: ["procedure", "argue", "narrate"],
    readerLevel: "expert",
  });
  assert.deepEqual(state, before);
  assert.deepEqual(
    resolveDirection({ ...state, direction: { mode: "auto", readerLevel: "expert" } }),
    {
      modes: WRITING_MODES,
      readerLevel: "expert",
    },
  );
  assert.deepEqual(
    resolveDirection({ ...state, direction: { mode: "argue", readerLevel: "auto" } }),
    {
      modes: ["procedure", "argue", "narrate"],
      readerLevel: "beginner",
    },
  );
});

test("FLOW-002: absent or auto direction falls back to diagnosis, including legacy string sections", () => {
  const artifacts = {
    diagnose: { output: { primaryMode: "explain", readerLevel: "intermediate" } },
    outline: { output: { sections: ["첫 구간", "다음 구간"] } },
  };
  for (const direction of [undefined, { mode: "auto", readerLevel: "auto" }])
    assert.deepEqual(resolveDirection({ artifacts, direction }), {
      modes: ["explain"],
      readerLevel: "intermediate",
    });
  assert.deepEqual(resolveDirection({ artifacts: { outline: artifacts.outline } }), {
    modes: [],
    readerLevel: null,
  });
  assert.deepEqual(resolveDirection({}), { modes: [], readerLevel: null });
});

test("FLOW-002: section-only modes resolve without a diagnosis and unknown values are excluded", () => {
  assert.deepEqual(
    resolveDirection({
      artifacts: {
        diagnose: { output: { primaryMode: "explanation", readerLevel: "unknown" } },
        outline: { output: { sections: [{ mode: "narrate" }, { mode: "unknown" }, null] } },
      },
    }),
    { modes: ["narrate"], readerLevel: null },
  );
});

test("RES-004: every mode has draft and review bundles; unused bundles stay out", () => {
  assert.deepEqual(Object.keys(MODE_RULES), WRITING_MODES);
  assert.deepEqual(Object.keys(LEVEL_RULES), READER_LEVELS);
  for (const stage of ["draft", "review"]) {
    for (const mode of WRITING_MODES) {
      const rules = seasoningRules(stage, { modes: [mode], readerLevel: null });
      for (const rule of [...BASE[stage], ...MODE_RULES[mode][stage]])
        assert.ok(typeof rule === "string" && rule.length > 0 && rules.includes(rule));
      for (const other of WRITING_MODES.filter((value) => value !== mode))
        for (const rule of MODE_RULES[other][stage]) assert.ok(!rules.includes(rule));
    }
    for (const level of READER_LEVELS) {
      const rules = seasoningRules(stage, { modes: [], readerLevel: level });
      for (const rule of LEVEL_RULES[level]) assert.ok(rules.includes(rule));
      for (const other of READER_LEVELS.filter((value) => value !== level))
        for (const rule of LEVEL_RULES[other]) assert.ok(!rules.includes(rule));
    }
    assert.deepEqual(seasoningRules(stage, { modes: [], readerLevel: null }), BASE[stage]);
  }
  assert.deepEqual(seasoningRules("outline", { modes: WRITING_MODES, readerLevel: "expert" }), []);
});

test("RES-004: mode bundles state their genre boundaries", () => {
  for (const stage of ["draft", "review"]) {
    assert.match(MODE_RULES.procedure[stage].join(" "), /비유 체계·캐릭터/);
    assert.match(MODE_RULES.argue[stage].join(" "), /수준 배지·연습 문제/);
    assert.match(MODE_RULES.narrate[stage].join(" "), /정의→비유→이유 틀·표/);
    assert.match(BASE[stage].join(" "), /explain 설계 카드를 다른 mode/);
  }
});

test("RES-005: review reports principle IDs, section locations and paraphrase as a proxy", () => {
  const rules = seasoningRules("review", { modes: ["explain"], readerLevel: "beginner" }).join(" ");
  assert.match(rules, /원칙 ID\(P1~P6\)·구간·문제 표현·이유/);
  assert.match(rules, /독자 말로 3문장 재진술\(paraphrase\)/);
  assert.match(rules, /원문과 불일치/);
  assert.match(rules, /AI 대리 지표/);
});
