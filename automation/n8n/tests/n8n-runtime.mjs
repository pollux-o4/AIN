import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { makeServer } from "../../runtime/server.mjs";
import { startIsolatedN8n } from "../testing/runtime.mjs";

// FLOW-002: real authenticated transport; the worker alone decides whether to continue.
const calls = [];
const signalListeners = process.listenerCount("SIGTERM");
const token = "fixture-transport-not-a-live-secret";
const id = "00000000-0000-4000-8000-000000000003";
const server = makeServer({
  token,
  editorial: {
    async advance(receivedId, context) {
      calls.push({ id: receivedId, context, at: Date.now() });
      return {
        id: receivedId,
        continue: calls.length < 3,
        // These values cannot influence the pipe: only continue controls its loop.
        status: "failed",
        maxCalls: 0,
        satisfied: true,
      };
    },
  },
});
let runtime;
try {
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  const bridgeUrl = `http://127.0.0.1:${server.address().port}`;
  const unauthorized = await fetch(`${bridgeUrl}/editorial/runs/${id}/advance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ executionId: "unauthorized" }),
  });
  assert.equal(unauthorized.status, 401);
  await unauthorized.body?.cancel();
  assert.equal(calls.length, 0);
  const base = resolve(".local/n8n-runtime-tests");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "run-"));
  await assert.rejects(
    () => startIsolatedN8n({ root, port: 5678, bridgeUrl, token }),
    /Invalid isolated n8n port/,
  );
  await assert.rejects(
    () => startIsolatedN8n({ root, port: server.address().port, bridgeUrl, token }),
    { code: "EADDRINUSE" },
  );
  assert.deepEqual(await readdir(root), []);
  runtime = await startIsolatedN8n({ root, port: 5688, bridgeUrl, token });
  for (const authorization of [null, "Bearer wrong-fixture-token"]) {
    const response = await fetch(`${runtime.url}/webhook/ain-editorial`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify({ id }),
    });
    assert.ok(
      [401, 403].includes(response.status),
      `Webhook rejected with HTTP ${response.status}`,
    );
    await response.body?.cancel();
  }
  assert.equal(calls.length, 0);
  await runtime.dispatch(id);
  const deadline = Date.now() + 20000;
  while (calls.length < 3 && Date.now() < deadline) await delay(100);
  assert.equal(calls.length, 3, "Webhook must forward and repeat while continue is true");
  assert.ok(calls.every((call) => call.id === id));
  assert.ok(calls.every((call) => Object.keys(call.context).join() === "executionId"));
  const executionId = calls[0].context.executionId;
  assert.match(executionId, /^[a-zA-Z0-9_-]+$/);
  assert.ok(calls.every((call) => call.context.executionId === executionId));
  assert.ok(calls[1].at - calls[0].at >= 1500, "Continue must pass through Wait");
  assert.ok(calls[2].at - calls[1].at >= 1500);
  await delay(2500);
  assert.equal(calls.length, 3, "False continue must stop the workflow");
  process.emit("SIGTERM");
  await Promise.all([runtime.stop(), runtime.stop()]);
  assert.equal(process.listenerCount("SIGTERM"), signalListeners);
  await assert.rejects(() => runtime.dispatch(id), /not running/);
  await assert.rejects(() =>
    fetch(`${runtime.url}/healthz`, { signal: AbortSignal.timeout(1000) }),
  );
  console.log(
    "FLOW-002 verified: authentication, ID forwarding, Wait/continue, isolation and signal cleanup",
  );
} finally {
  await runtime?.stop();
  await new Promise((done) => server.close(done));
}
