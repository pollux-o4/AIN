import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { editorialHttp } from "../http.mjs";

test("local UI cookies, cross-origin rejection, escaped AI text and exact downloads", async (t) => {
  const advances = [];
  const service = {
    list: () => [],
    history: () => ({ records: [] }),
    get: () => ({
      text: "<script>alert(1)</script>\n\n[위험](javascript:alert(1))",
      id: "00000000-0000-0000-0000-000000000000",
      monitor: { events: [{ executionId: "41" }], executionId: "42" },
    }),
    create: () => ({ id: "test" }),
    archive: (id) => ({ id, archived: true }),
    download: () => ({ text: "정확한 본문\n", filename: "article.txt" }),
    advance: (id, context) => {
      advances.push({ id, context });
      return { id, continue: false };
    },
  };
  const route = editorialHttp({ service, token: "fixture-token-long-enough-not-a-real-secret" });
  const server = createServer(async (req, res) => {
    if (!(await route(req, res))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${origin}/write/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('id="root"'));
  const script = html.match(/src="(\/write\/assets\/[\w-]+\.js)"/)?.[1];
  assert.ok(script, "Vite bundle must be served from the same origin");
  const bundle = await fetch(origin + script);
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get("content-type"), /javascript/);
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
  const session = await fetch(`${origin}/write/session`);
  assert.equal(session.status, 204);
  assert.match(session.headers.getSetCookie()[0], /HttpOnly; SameSite=Strict; Path=\/write\//);
  assert.equal(
    (await fetch(`${origin}/write/session`, { headers: { Origin: "https://evil.example" } }))
      .status,
    403,
  );
  assert.equal((await fetch(`${origin}/write/assets/%2e%2e%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${origin}/write/assets/missing.js`)).status, 404);
  const cookie = page.headers.getSetCookie()[0].split(";")[0];
  assert.equal((await fetch(`${origin}/write/api/runs`)).status, 401);
  assert.equal(
    (await fetch(`${origin}/write/api/runs/00000000-0000-0000-0000-000000000000/history`)).status,
    401,
  );
  const archiveUrl = `${origin}/write/api/runs/00000000-0000-0000-0000-000000000000/archive`;
  assert.equal(
    (await fetch(archiveUrl, { method: "POST", headers: { Cookie: cookie } })).status,
    403,
  );
  const archived = await fetch(archiveUrl, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin },
  });
  assert.deepEqual(await archived.json(), {
    id: "00000000-0000-0000-0000-000000000000",
    archived: true,
  });
  const history = await fetch(
    `${origin}/write/api/runs/00000000-0000-0000-0000-000000000000/history`,
    { headers: { cookie } },
  );
  assert.deepEqual(await history.json(), { records: [] });
  assert.equal(
    (
      await fetch(`${origin}/write/api/runs`, {
        method: "POST",
        headers: { cookie, Origin: "https://evil.example", "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
  const headers = { cookie, Origin: origin, "Content-Type": "application/json" };
  assert.equal(
    (await fetch(`${origin}/write/api/runs`, { method: "POST", headers, body: "{}" })).status,
    202,
  );
  const id = "00000000-0000-0000-0000-000000000000";
  const workerUrl = `${origin}/editorial/runs/${id}/advance`;
  assert.equal((await fetch(workerUrl, { method: "POST", headers, body: "{}" })).status, 401);
  assert.equal(advances.length, 0);
  const worker = await fetch(workerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fixture-token-long-enough-not-a-real-secret",
    },
    body: JSON.stringify({ executionId: "worker-42" }),
  });
  assert.equal(worker.status, 200);
  assert.deepEqual(await worker.json(), { id, continue: false });
  assert.deepEqual(advances, [{ id, context: { executionId: "worker-42" } }]);
  const view = await (
    await fetch(`${origin}/write/api/runs/${id}`, { headers: { cookie } })
  ).json();
  assert.deepEqual(
    view.executionLinks.map((link) => link.url),
    [
      "http://localhost:5678/workflow/blogEditorialServiceV1/executions/41",
      "http://localhost:5678/workflow/blogEditorialServiceV1/executions/42",
    ],
  );
  assert.ok(!view.html.includes("<script>"));
  assert.ok(!view.html.includes('href="javascript:'));
  const file = await fetch(`${origin}/write/api/runs/${id}/download`, { headers: { cookie } });
  assert.equal(await file.text(), "정확한 본문\n");
  assert.match(file.headers.get("content-disposition"), /attachment/);
});

test("LIVE-001: authenticated stream, origin rejection, snapshots and cleanup", async (t) => {
  let observers = 0,
    stopped = 0;
  const service = {
    observeActivity(_id, emit) {
      observers++;
      emit({ phase: "generating", text: "부분 출력", active: true });
      return () => {
        stopped++;
      };
    },
  };
  const route = editorialHttp({ service, token: "fixture-token-long-enough-not-a-real-secret" });
  const server = createServer((req, res) => {
    void route(req, res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const path = "/write/api/runs/00000000-0000-0000-0000-000000000000/activity";
  assert.equal((await fetch(origin + path)).status, 401);
  const session = await fetch(`${origin}/write/session`);
  const cookie = session.headers.getSetCookie()[0].split(";")[0];
  assert.equal(
    (await fetch(origin + path, { headers: { cookie, Origin: "https://evil.example" } })).status,
    403,
  );
  assert.equal(observers, 0);
  const controller = new AbortController();
  const response = await fetch(origin + path, { headers: { cookie }, signal: controller.signal });
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: activity/);
  assert.match(first, /部分|부분 출력/);
  controller.abort();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(observers, 1);
  assert.equal(stopped, 1);
});
