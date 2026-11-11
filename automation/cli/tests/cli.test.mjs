// 검증: AGENT-001
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { editorialHttp } from "../../editorial/index.mjs";
import { main } from "../ain.mjs";
import { AinClient } from "../client.mjs";

const ID = "00000000-0000-0000-0000-000000000000";
const agentToken = "agent-token-fixture-long-enough-000000";

async function fixture(t) {
  const calls = [];
  let status = "waiting_ai";
  const view = () => ({
    id: ID,
    title: "초안",
    status,
    version: 7,
    revision: 1,
    textRevision: 1,
    text: "# 초안\n\n본문",
    findings: [],
    monitor: { label: "진행", canPause: true, canResume: false, events: [] },
  });
  const service = {
    list: () => [{ id: ID, title: "초안" }],
    get: () => {
      const run = view();
      status = "awaiting_user";
      return run;
    },
    create: (body) => {
      calls.push(["create", body]);
      return view();
    },
    action: (id, body) => {
      calls.push(["action", id, body]);
      return view();
    },
    archive: (id) => {
      calls.push(["archive", id]);
      return { id, archived: true };
    },
    download: () => ({ text: "본문\n", filename: "a.txt" }),
  };
  const route = editorialHttp({
    service,
    token: "bridge-token-fixture-long-enough-0000",
    agentToken,
  });
  const server = createServer(async (req, res) => {
    if (!(await route(req, res))) res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const io = (token = agentToken) => ({
    readFile: async () => "자료",
    sleep: async () => {},
    client: async () => new AinClient({ baseUrl, token }),
  });
  return { calls, baseUrl, io };
}

test("agent_001 CLI drives the write API with a separate token", async (t) => {
  const f = await fixture(t);
  const run = (argv, io = f.io()) => main(argv, io);
  assert.equal(JSON.parse((await run(["list"])).out)[0].id, ID);
  const created = JSON.parse(
    (await run(["new", "--idea", "글감", "--mode", "explain", "--source-file", "x"])).out,
  );
  assert.equal(created.id, ID);
  assert.deepEqual(f.calls[0][1].direction, { mode: "explain", readerLevel: "auto" });
  assert.equal(f.calls[0][1].source, "자료");
  const waited = JSON.parse((await run(["wait", ID])).out);
  assert.equal(waited.status, "awaiting_user");
  assert.equal(waited.text, "# 초안\n\n본문");
  await run(["feedback", ID, "사례를", "추가"]);
  assert.equal(f.calls.at(-1)[2].feedback, "사례를 추가");
  assert.equal(f.calls.at(-1)[2].expectedVersion, 7);
  await run(["satisfy", ID]);
  assert.equal(f.calls.at(-1)[2].type, "satisfy");
  assert.equal((await run(["download", ID])).out, "본문\n");
  assert.deepEqual(JSON.parse((await run(["delete", ID])).out), { id: ID, archived: true });
  await assert.rejects(() => run(["new", "--idea", "x", "--mode", "poem"]), /--mode/);
  assert.equal((await run(["nope"])).code, 2);
});

test("agent_001 token is required and never accepted from browsers", async (t) => {
  const f = await fixture(t);
  await assert.rejects(() => main(["list"], f.io("wrong-token-wrong-token-wrong-token-00")), {
    status: 401,
  });
  const browser = await fetch(`${f.baseUrl}/write/api/runs`, {
    headers: { Authorization: `Bearer ${agentToken}`, Origin: f.baseUrl },
  });
  assert.equal(browser.status, 401);
  assert.throws(() => editorialHttp({ service: {}, token: agentToken, agentToken }), /separate/);
});
