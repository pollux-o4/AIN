// 검증: OPS-001 기동·종료
import assert from "node:assert/strict";
import test from "node:test";
import { activeRuns, isStale, ownedRole } from "../lifecycle.mjs";

const root = "/repo";

test("이 저장소에서 띄운 서비스만 소유 대상", () => {
  assert.equal(
    ownedRole({ cwd: root, cmdline: "node automation/runtime/server.mjs" }, root),
    "bridge",
  );
  assert.equal(
    ownedRole({ cwd: root, cmdline: "node automation/runtime/start.mjs" }, root),
    "supervisor",
  );
  assert.equal(ownedRole({ cwd: root, cmdline: "node /x/bin/n8n start" }, root), "n8n");
  assert.equal(
    ownedRole({ cwd: "/other", cmdline: "node automation/runtime/server.mjs" }, root),
    null,
  );
  assert.equal(ownedRole({ cwd: root, cmdline: "paseo daemon run" }, root), null);
});

test("AI 대기 상태만 진행 중 작업", () => {
  const runs = [
    { id: "a", state: { status: "waiting_ai", idea: "아키텍처" } },
    { id: "b", state: { status: "waiting_route" } },
    { id: "c", state: { status: "awaiting_user" } },
  ];
  assert.deepEqual(
    activeRuns(runs).map((r) => r.id),
    ["a", "b"],
  );
});

test("코드 변경 이전에 시작한 브리지는 오래된 것", () => {
  assert.equal(isStale(1, 2), true);
  assert.equal(isStale(3, 2), false);
});
