import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { editorialWorkflow } from "../build-editorial-workflow.mjs";

test("ARCH-001: n8n has only transport nodes and no editorial policy copy", async () => {
  const workflow = editorialWorkflow();
  const generated = JSON.parse(
    await readFile(new URL("../blog-editorial-service.json", import.meta.url), "utf8"),
  );
  assert.deepEqual({ ...generated, versionId: null }, { ...workflow, versionId: null });
  assert.equal(workflow.id, "blogEditorialServiceV1");
  assert.deepEqual(
    workflow.nodes
      .filter((node) => node.type !== "n8n-nodes-base.stickyNote")
      .map((node) => node.type),
    ["webhook", "httpRequest", "if", "wait"].map((type) => `n8n-nodes-base.${type}`),
  );
  assert.doesNotMatch(
    JSON.stringify(workflow),
    /jsCode|state\.|artifacts|revision|maxCalls|callsUsed|maxRunMs|provider|model|satisf|publication|\/jobs|\/exports/,
  );
});
