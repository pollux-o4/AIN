import assert from "node:assert/strict";
import test from "node:test";
import { stageOutputSchemas } from "../../contracts/ai-output.mjs";
import { DEFAULT_DIRECTION, READER_LEVELS, WRITING_MODES } from "../../contracts/writing-modes.mjs";
import { fixtureOutputs } from "./browser-server.mjs";

test("browser fixture honors direction and returns valid cards with mixed modes", () => {
  for (const direction of [
    undefined,
    DEFAULT_DIRECTION,
    ...WRITING_MODES.flatMap((mode) => READER_LEVELS.map((readerLevel) => ({ mode, readerLevel }))),
  ]) {
    const outputs = fixtureOutputs({ idea: "fixture", direction });
    for (const [stage, schema] of Object.entries(stageOutputSchemas))
      assert.deepEqual(schema.parse(outputs[stage]), outputs[stage]);
    assert.equal(
      outputs.diagnose.primaryMode,
      !direction || direction.mode === "auto" ? "explain" : direction.mode,
    );
    assert.equal(
      outputs.diagnose.readerLevel,
      !direction || direction.readerLevel === "auto" ? "beginner" : direction.readerLevel,
    );
    assert.ok(outputs.outline.sections.every((section) => section.title && section.keyPoint));
    assert.equal(outputs.outline.sections[0].mode, outputs.diagnose.primaryMode);
    const modes = new Set(outputs.outline.sections.map((section) => section.mode));
    assert.ok(modes.size >= 2);
    assert.deepEqual([...modes], outputs.diagnose.sectionModes);
  }
});
