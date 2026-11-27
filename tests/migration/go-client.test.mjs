// 검증: AIN-API-001, AGENT-001, LIVE-001 · Go의 편집 응답/SSE 형식 합성 fixture
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import { AGENT_TOKEN_FILE } from "../../automation/contracts/runtime.mjs";
import { readAsset } from "../../automation/editorial/assets.mjs";
import { makeRun } from "../../automation/editorial/ui/stories/fixtures.ts";
import { clickAction, downloadedBytes, openDock } from "../writing.ts";
import { completionDelayMs, idea } from "./perf/fixture.mjs";
import { start } from "./perf/go-runtime.mjs";

const invoke = promisify(execFile);

async function serverFixture(t) {
  const run = makeRun({ status: "waiting_ai", activeAt: 6 });
  const rootPath = "/write/api/runs";
  const runPath = `${rootPath}/${run.id}`;
  const cookie = `editorial-session=${randomBytes(24).toString("hex")}`;
  const token = randomBytes(24).toString("hex");
  const actions = [];
  const streams = new Set();
  let connections = 0;
  let origin;
  delete run.monitor.executionId;
  run.monitor.canPause = true;

  const json = (res, status, value) =>
    res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
  const handlers = new Map([
    [`GET ${rootPath}`, (_req, res) => json(res, 200, { runs: [run] })],
    [`GET ${runPath}`, (_req, res) => json(res, 200, run)],
    [
      `GET ${runPath}/activity`,
      (_req, res) => {
        connections++;
        streams.add(res);
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
        res.write("retry: 25\n\n");
        res.on("close", () => streams.delete(res));
      },
    ],
    [
      `POST ${runPath}/actions`,
      async (req, res, actor) => {
        const parts = [];
        for await (const part of req) parts.push(part);
        const body = JSON.parse(Buffer.concat(parts));
        if (body.expectedVersion !== run.version) return json(res, 409, { error: "회차 충돌" });
        actions.push({ actor, body });
        const paused = body.type === "pause";
        run.version++;
        run.appliedOperations.push(body.operationId);
        run.status = paused ? "paused" : "waiting_ai";
        Object.assign(run.monitor, {
          kind: paused ? "paused" : "working",
          label: paused ? "중단됨" : "AI 작업 중",
          canPause: !paused,
          canResume: paused,
        });
        json(res, 200, run);
      },
    ],
  ]);
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, origin).pathname;
      if (req.method === "GET") {
        if (path === "/write/session") {
          res
            .writeHead(204, { "Set-Cookie": `${cookie}; Path=/write/; HttpOnly; SameSite=Strict` })
            .end();
          return;
        }
        const asset = await readAsset(path);
        if (asset) {
          res.writeHead(200, { "Content-Type": asset.type }).end(asset.content);
          return;
        }
      }
      const agent = !req.headers.origin && req.headers.authorization === `Bearer ${token}`;
      const user = req.headers.cookie === cookie;
      if (!agent && !user) return json(res, 401, { error: "인증 필요" });
      if (!agent && req.method === "POST" && req.headers.origin !== origin)
        return json(res, 403, { error: "다른 출처" });
      const route = handlers.get(`${req.method} ${path}`);
      if (!route) return json(res, 404, { error: "fixture에 없는 경로" });
      await route(req, res, agent ? "agent" : "user");
    } catch {
      json(res, 500, { error: "fixture 응답 오류" });
    }
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", done);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    const closed = new Promise((done) => server.close(done));
    server.closeAllConnections();
    await closed;
  });
  function send(revision, note, active = true) {
    const activity = {
      revision,
      stage: "draft",
      name: "초고 작성",
      active,
      phase: active ? "generating" : "complete",
      text: "",
      truncated: false,
      lastOutputAt: null,
      steps: [{ kind: "note", text: note, at: null }],
    };
    for (const stream of streams)
      stream.write(`event: activity\ndata: ${JSON.stringify(activity)}\n\n`);
  }
  const scratch = await mkdtemp(join(tmpdir(), "ain-go-client-"));
  t.after(() => rm(scratch, { recursive: true }));
  await writeFile(join(scratch, AGENT_TOKEN_FILE), token, { mode: 0o600 });
  const cli = (...args) =>
    invoke(process.execPath, ["automation/cli/ain.mjs", ...args], {
      env: { ...process.env, AIN_RUNTIME_DIR: scratch, AIN_URL: origin },
      timeout: 5000,
    });
  return {
    origin,
    run,
    actions,
    cli,
    send,
    connections: () => connections,
    disconnect: () => {
      for (const stream of streams) stream.end();
    },
  };
}

test("Go 응답 fixture의 화면·CLI 변경과 이전 회차를 제외하는 SSE 재접속", async (t) => {
  const fixture = await serverFixture(t);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const { id, revision, version } = fixture.run;
  await page.goto(`${fixture.origin}/write/#${id}`);
  await expect(page.locator("#work-title")).toHaveText(fixture.run.title, { timeout: 10000 });
  const toggle = page.locator("#work-dock .dock-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const liveTab = page.getByRole("tab", { name: "실시간", exact: true });
  if (await liveTab.isVisible()) await liveTab.click();
  await expect.poll(fixture.connections).toBe(1);

  const activity = page.locator("#live-activity");
  fixture.send(revision, "첫 연결의 현재 회차");
  await expect(activity).toContainText("첫 연결의 현재 회차");
  fixture.disconnect();
  await expect.poll(fixture.connections).toBe(2);
  // 이전 회차의 완료 신호가 새 스트림을 닫으면 바로 뒤의 현재 회차를 받을 수 없다.
  fixture.send(revision - 1, "이전 회차 신호", false);
  fixture.send(revision, "재접속한 현재 회차");
  await expect(activity).toContainText("재접속한 현재 회차");
  await expect(activity).not.toContainText("이전 회차 신호");

  await page.locator("#dock-pause").click();
  await expect(page.locator("#status")).toHaveText("중단됨");
  assert.equal(fixture.actions[0].actor, "user");
  assert.equal(fixture.actions[0].body.expectedVersion, version);
  assert.equal(fixture.actions[0].body.type, "pause");
  assert.match(fixture.actions[0].body.operationId, /^[0-9a-f-]{36}$/);

  const list = JSON.parse((await fixture.cli("list")).stdout);
  assert.equal(list[0].id, id);
  await fixture.cli("resume", id);
  assert.equal(fixture.actions[1].actor, "agent");
  assert.equal(fixture.actions[1].body.expectedVersion, version + 1);
  assert.equal(fixture.actions[1].body.type, "resume");
  await assert.rejects(() => fixture.cli("unrecognized"), { code: 2 });
});

test("Go 런타임의 초안·승인·TXT를 PC·모바일과 CLI에서 검증", { timeout: 30000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ain-go-browser-"));
  t.after(() => rm(root, { recursive: true }));
  const runtime = await start({ root, completionDelayMs, historyCount: 1, historyBytes: 1024 });
  t.after(() => runtime.stop());
  const token = "synthetic-agent-key-not-a-secret00";
  await writeFile(join(root, AGENT_TOKEN_FILE), token, { mode: 0o600 });
  const cli = async (...args) => {
    const { stdout } = await invoke(process.execPath, ["automation/cli/ain.mjs", ...args], {
      env: { ...process.env, AIN_RUNTIME_DIR: root, AIN_URL: runtime.url },
      timeout: 10000,
    });
    return JSON.parse(stdout);
  };

  const browser = await chromium.launch();
  t.after(() => browser.close());
  const profiles = {
    desktop: { viewport: { width: 1440, height: 1000 } },
    mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  };
  await Promise.all(
    Object.entries(profiles).map(async ([name, options]) => {
      const created = await cli("new", "--idea", idea);
      const completed = await cli("wait", created.id, "--timeout", "8");
      assert.equal(completed.status, "awaiting_user");
      const page = await browser.newPage({ ...options, baseURL: runtime.url });
      try {
        const response = await page.goto(`${runtime.url}/write/#${created.id}`);
        assert.equal(response.status(), 200, name);
        await expect(page.locator("#article")).toContainText(
          "주문은 고객이 무엇을 샀는지 기록하는 책임을 집니다.",
        );
        await expect(page.locator("#work-title")).toHaveText("쇼핑몰의 책임");
        const download = page.waitForEvent("download");
        await page.getByRole("link", { name: "TXT 내려받기", exact: true }).click();
        assert.match((await downloadedBytes(await download)).toString("utf8"), /쇼핑몰의 책임/);
        const confirmed = await clickAction(page, "초안 확정", "satisfy");
        assert.equal(confirmed.after.status, "satisfied");
        if (name === "desktop") {
          await clickAction(page, "시각자료 추가", "request_figures");
          const choice = page.locator("#figure-choice");
          await expect(choice).toBeVisible();
          await openDock(page, "확인");
          const checkboxes = choice.getByRole("checkbox");
          await expect(checkboxes).toHaveCount(2);
          await checkboxes.nth(0).check();
          await checkboxes.nth(1).check();
          await clickAction(page, "2곳에 만들기", "select_figures");
          await expect(page.locator("#figure-design")).toBeVisible();
          await clickAction(page, "이대로 그리기", "approve_design");
          const review = page.locator("#figure-review");
          await expect(review).toBeVisible();
          await clickAction(page, "시각자료 확인", "confirm_figures");
          await expect(page.locator("#article figure")).toHaveCount(2);
        }
        const approved = await clickAction(page, "발행 준비 승인", "authorize_publication");
        assert.equal(approved.after.status, "publication_ready");
      } finally {
        await page.close();
      }
    }),
  );
  assert.equal((await cli("list", "--ready")).length, 2);
});
