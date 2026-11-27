import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { AGENT_TOKEN_FILE, RUNTIME_PROTOCOL } from "../../../automation/contracts/runtime.mjs";
import { hash, uiRoot, verifyManifest } from "./manifest.mjs";

const { values } = parseArgs({
  options: { package: { type: "string" }, browser: { type: "boolean" } },
});
if (!values.package)
  throw new Error("Usage: node backend/tools/release/smoke.mjs --package PATH [--browser]");
const source = resolve(values.package);
const scratch = await mkdtemp(join(tmpdir(), "ain-release-smoke-"));
const relocated = join(scratch, "relocated install");
const emptyPath = join(scratch, "empty-path");
const home = join(scratch, "home");
const paseo = join(scratch, "no-daemon");
const data = join(scratch, "data");
const token = randomBytes(32).toString("hex");
const session = randomBytes(32).toString("hex");
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const execute = promisify(execFile);

async function loopbackPort() {
  const probe = createServer();
  await new Promise((done, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", done);
  });
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}

async function uiSmoke(url) {
  const { chromium, expect } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const requests = [];
    page.on("request", (request) => requests.push(new URL(request.url()).origin));
    await page.goto(`${url}/write/`);
    await expect(page.getByRole("heading", { name: "내 글", exact: true })).toBeVisible();
    await expect(page.getByText("아직 쓴 글이 없습니다.")).toBeVisible();
    assert.ok(
      requests.every((origin) => origin === url),
      "UI made an off-host request",
    );
  } finally {
    await browser.close();
  }
}

async function serveSmoke(manifest) {
  const address = `127.0.0.1:${await loopbackPort()}`;
  const url = `http://${address}`;
  const child = spawn(
    join(relocated, "bin", "ain"),
    [
      "-listen",
      address,
      "-data",
      data,
      "-assets",
      join(relocated, uiRoot),
      "-paseo-home",
      paseo,
      "-provider",
      "synthetic",
      "-model",
      "unused",
    ],
    {
      cwd: scratch,
      env: {
        PATH: emptyPath,
        HOME: home,
        TZ: "UTC",
        AIN_SESSION_KEY: session,
        AIN_AGENT_TOKEN: token,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let errors = "";
  child.stderr.on("data", (part) => {
    errors = (errors + part.toString()).slice(-1000);
  });
  const closed = new Promise((done) =>
    child.once("close", (code, signal) => done({ code, signal })),
  );
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  async function request(path, headers = {}) {
    return fetch(url + path, { headers, signal: AbortSignal.timeout(750) });
  }
  try {
    let ready;
    for (let attempt = 0; attempt < 80 && child.exitCode === null && !spawnError; attempt++) {
      const result = await request("/healthz").catch(() => null);
      if (result?.ok) {
        ready = await result.json();
        break;
      }
      await result?.body?.cancel();
      await delay(75);
    }
    assert.deepEqual(
      ready,
      { status: "ok", protocol: RUNTIME_PROTOCOL },
      errors || spawnError?.message,
    );
    const denied = await request("/write/api/runs");
    assert.equal(denied.status, 401);
    await denied.body.cancel();
    const webSession = await request("/write/session");
    assert.equal(webSession.status, 204);
    const cookie = webSession.headers.getSetCookie()[0]?.split(";")[0];
    assert.ok(cookie, "Browser session was not set");
    const browserList = await request("/write/api/runs", { cookie });
    assert.equal(browserList.status, 200);
    assert.deepEqual(await browserList.json(), { runs: [] });

    for (const file of manifest.files) {
      if (!file.path.startsWith(uiRoot)) continue;
      const path = file.path.slice(uiRoot.length).replace("/index.html", "/");
      const response = await request(`/write${path}`);
      assert.equal(response.status, 200, path);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), file.sha256, path);
    }
    const { stdout } = await execute(
      process.execPath,
      [join(repo, "automation/cli/ain.mjs"), "list"],
      {
        cwd: scratch,
        env: { PATH: emptyPath, HOME: home, AIN_URL: url, AIN_RUNTIME_DIR: data },
        timeout: 5000,
      },
    );
    assert.deepEqual(JSON.parse(stdout), []);
    if (values.browser) await uiSmoke(url);
  } finally {
    child.kill("SIGTERM");
    const forced = setTimeout(() => child.kill("SIGKILL"), 5000);
    const result = await closed;
    clearTimeout(forced);
    assert.equal(result.code, 0, errors || result.signal);
  }
}

try {
  await verifyManifest(source);
  await cp(source, relocated, { recursive: true });
  const manifest = await verifyManifest(relocated);
  for (const path of [emptyPath, home, paseo, data]) await mkdir(path, { mode: 0o700 });
  await writeFile(join(data, AGENT_TOKEN_FILE), `${token}\n`, { mode: 0o600 });
  await serveSmoke(manifest);
  await verifyManifest(relocated);
  console.log(
    `Relocated package passed with empty server PATH${values.browser ? ", Chromium" : ""}, and separate Node CLI`,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
