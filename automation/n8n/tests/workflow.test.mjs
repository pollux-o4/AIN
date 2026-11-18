import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { editorialWorkflow } from "../build-editorial-workflow.mjs";

test("전달 노드는 일시 오류·느린 작업 생성에 루프가 끊기지 않는다", () => {
  const advance = editorialWorkflow().nodes.find((node) => node.id === "advance");
  // 실측: 작업 생성(제공자 준비 대기 포함) 33초 → 30초 제한 1회 초과로 루프 종료, 완성된 AI 결과 미수거
  assert.ok(advance.parameters.options.timeout >= 90000);
  assert.equal(advance.retryOnFail, true);
  assert.ok(advance.maxTries >= 3);
});

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
