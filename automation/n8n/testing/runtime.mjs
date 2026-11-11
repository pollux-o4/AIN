import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, lstat, readdir, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { editorialWorkflow } from "../build-editorial-workflow.mjs";

export async function startIsolatedN8n({ root, port, bridgeUrl, token }) {
  const bridge = new URL(bridgeUrl);
  if (bridge.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(bridge.hostname))
    throw new Error("Fixture bridge must use loopback HTTP");
  if (!Number.isInteger(port) || port < 1024 || port > 65534 || [5677, 5678].includes(port))
    throw new Error("Invalid isolated n8n port");
  if (typeof token !== "string" || token.length < 32 || /[\r\n]/.test(token))
    throw new Error("Fixture token required");
  root = resolve(root);
  if (!(await lstat(root)).isDirectory() || (await readdir(root)).length)
    throw new Error("Fixture root must be an empty directory created by the caller");
  await chmod(root, 0o700);
  for (const candidate of [port, port + 1]) {
    const probe = createServer();
    await new Promise((done, reject) => {
      probe.once("error", reject);
      probe.listen(candidate, "127.0.0.1", done);
    });
    await new Promise((done) => probe.close(done));
  }
  const url = `http://127.0.0.1:${port}`;
  // Inherit executable discovery only; live n8n DB, credentials and config never enter fixtures.
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    N8N_USER_FOLDER: root,
    DB_TYPE: "sqlite",
    DB_SQLITE_DATABASE: join(root, "database.sqlite"),
    N8N_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    N8N_LISTEN_ADDRESS: "127.0.0.1",
    N8N_HOST: "127.0.0.1",
    N8N_PORT: String(port),
    N8N_PROTOCOL: "http",
    N8N_RUNNERS_BROKER_PORT: String(port + 1),
    N8N_RUNNERS_BROKER_LISTEN_ADDRESS: "127.0.0.1",
    N8N_DIAGNOSTICS_ENABLED: "false",
    N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
    N8N_TEMPLATES_ENABLED: "false",
    N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: "true",
    N8N_SECURE_COOKIE: "false",
    N8N_LOG_LEVEL: "error",
    EXECUTIONS_DATA_SAVE_ON_ERROR: "none",
    EXECUTIONS_DATA_SAVE_ON_SUCCESS: "none",
    EXECUTIONS_DATA_SAVE_ON_PROGRESS: "false",
    EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS: "false",
  };
  const children = new Set();
  let stopping;
  function launch(args) {
    if (stopping) throw new Error("Isolated n8n stopped");
    // No child output is persisted: n8n errors can include credentials or execution bodies.
    const child = spawn("n8n", args, { env, stdio: "ignore", detached: true });
    const running = { child, error: null, closed: null };
    children.add(running);
    child.once("error", (error) => {
      running.error = error.code ?? "spawn_failed";
    });
    running.closed = new Promise((done) =>
      child.once("close", (code) => {
        children.delete(running);
        done(code);
      }),
    );
    return running;
  }
  function kill(running, signal) {
    if (!running.child.pid) return;
    try {
      process.kill(-running.child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  async function terminate(running) {
    kill(running, "SIGTERM");
    const timeout = setTimeout(() => kill(running, "SIGKILL"), 5000);
    try {
      await running.closed;
    } finally {
      clearTimeout(timeout);
    }
  }
  function onSignal() {
    void stop();
  }
  function stop() {
    stopping ??= (async () => {
      for (const signal of ["SIGINT", "SIGTERM"]) process.off(signal, onSignal);
      await Promise.all([...children].map(terminate));
    })();
    return stopping;
  }
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, onSignal);
  async function command(label, args) {
    const running = launch(args);
    const timeout = setTimeout(() => kill(running, "SIGKILL"), 60000);
    try {
      if ((await running.closed) !== 0 || running.error)
        throw new Error(`Isolated n8n ${label} failed`);
    } finally {
      clearTimeout(timeout);
    }
  }
  async function request(path, options = {}) {
    const response = await fetch(url + path, { ...options, signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Isolated n8n request failed (HTTP ${response.status})`);
    }
    return response;
  }
  const credentialPath = join(root, "credentials.json");
  try {
    await writeFile(
      credentialPath,
      JSON.stringify([
        {
          id: "localPaseoBridge",
          name: "Local Paseo bridge",
          type: "httpHeaderAuth",
          data: { name: "Authorization", value: `Bearer ${token}` },
        },
      ]),
      { mode: 0o600, flag: "wx" },
    );
    const workflow = editorialWorkflow({ bridgeUrl });
    const workflowPath = join(root, "workflow.json");
    await writeFile(workflowPath, JSON.stringify(workflow), { mode: 0o600, flag: "wx" });
    await command("credential import", ["import:credentials", `--input=${credentialPath}`]);
    await unlink(credentialPath);
    await command("workflow import", ["import:workflow", `--input=${workflowPath}`]);
    const running = launch(["start"]);
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (stopping || running.error || !children.has(running))
        throw new Error("Isolated n8n stopped before readiness");
      try {
        const response = await fetch(`${url}/healthz/readiness`, {
          signal: AbortSignal.timeout(1000),
        });
        ready = response.ok;
        await response.body?.cancel();
      } catch {}
      if (ready) break;
      await delay(500);
    }
    if (!ready) throw new Error("Isolated n8n startup timed out");
    const owner = await request("/rest/owner/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "sample-user@example.test",
        password: "FixtureOnly123!Pass",
        firstName: "Sample",
        lastName: "User",
      }),
    });
    const headers = {
      "Content-Type": "application/json",
      cookie: owner.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0])
        .join("; "),
    };
    await owner.body?.cancel();
    const imported = (await (await request(`/rest/workflows/${workflow.id}`, { headers })).json())
      .data;
    const activated = await request(`/rest/workflows/${workflow.id}/activate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ versionId: imported.versionId, expectedChecksum: imported.checksum }),
    });
    await activated.body?.cancel();
    let registered = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (stopping || !children.has(running))
        throw new Error("Isolated n8n stopped before webhook registration");
      const response = await fetch(`${url}/webhook/ain-editorial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(5000),
      });
      registered = [401, 403].includes(response.status);
      await response.body?.cancel();
      if (registered) break;
      if (response.status !== 404) throw new Error("Isolated n8n webhook authentication failed");
      await delay(250);
    }
    if (!registered) throw new Error("Isolated n8n webhook registration timed out");
    if (stopping) throw new Error("Isolated n8n stopped before activation");
    return {
      url,
      async dispatch(id) {
        if (stopping || !children.has(running) || running.error)
          throw new Error("Isolated n8n is not running");
        const response = await request("/webhook/ain-editorial", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id }),
        });
        await response.body?.cancel();
      },
      stop,
    };
  } catch (error) {
    await stop();
    await unlink(credentialPath).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    throw error;
  }
}
