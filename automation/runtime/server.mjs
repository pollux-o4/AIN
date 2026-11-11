import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { connectLocalPaseo } from "../../../paseo/sdk.mjs";
import { AGENT_TOKEN_FILE, RUNTIME_PROTOCOL } from "../contracts/runtime.mjs";
import { EditorialService, EditorialStore, editorialHttp } from "../editorial/index.mjs";
import { Jobs } from "../paseo/index.mjs";

// Composition root: modules own policies; this file only wires their adapters and lifecycle.
export function makeServer({ token, agentToken = null, editorial, n8nUrl }) {
  if (typeof token !== "string" || token.length < 32) throw new Error("Bridge token required");
  const route = editorial ? editorialHttp({ service: editorial, token, agentToken, n8nUrl }) : null;
  return createServer(async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(data));
    };
    try {
      if (req.url === "/healthz" && req.method === "GET")
        return reply(200, { status: "ok", protocol: RUNTIME_PROTOCOL });
      if (route && (await route(req, res))) return;
      const path = new URL(req.url, "http://localhost").pathname;
      if (
        ["/jobs", "/exports", "/providers"].some(
          (prefix) => path === prefix || path.startsWith(`${prefix}/`),
        )
      )
        return reply(410, {
          error: "원시 실행 경로는 종료됐습니다. 글쓰기 화면과 편집 작업 계약을 사용해 주세요.",
        });
      reply(404, { error: "Not found" });
    } catch {
      reply(500, { error: "요청을 처리하지 못했습니다. 저장된 작업을 확인해 주세요." });
    }
  });
}

async function ensureAgentToken(path) {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const created = randomBytes(32).toString("hex");
    await writeFile(path, `${created}\n`, { mode: 0o600, flag: "wx" });
    return created;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const local = resolve(".local/ai-runtime");
  const token = (await readFile(join(local, "bridge-token"), "utf8")).trim();
  const agentToken = await ensureAgentToken(join(local, AGENT_TOKEN_FILE));
  const client = await connectLocalPaseo();
  const jobs = new Jobs({
    client,
    root: join(local, "jobs"),
    workRoot: join(local, "workspaces"),
    allowedProviders:
      process.env.AI_ALLOWED_PROVIDERS?.split(",").map((value) => value.trim()) ?? null,
  });
  const watchdog = setInterval(
    () => jobs.expire().catch(() => console.error("AI expiry check failed")),
    2000,
  );
  watchdog.unref();
  const store = new EditorialStore(join(local, "editorial.sqlite"));
  const n8nUrl = process.env.EDITORIAL_N8N_URL ?? "http://localhost:5678";
  const editorial = new EditorialService({
    store,
    jobs,
    dispatch: async (id) => {
      const response = await fetch(`${n8nUrl}/webhook/ain-editorial`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("n8n connection failed");
    },
  });
  const server = makeServer({ token, agentToken, editorial, n8nUrl });
  const port = Number(process.env.AI_BRIDGE_PORT ?? 3230);
  server.listen(port, "127.0.0.1", () => console.log(`AIN listening on 127.0.0.1:${port}`));
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      clearInterval(watchdog);
      // Long-lived observation streams must not keep shutdown open indefinitely.
      const drain = setTimeout(() => server.closeAllConnections(), 5000);
      drain.unref();
      server.close(async () => {
        clearTimeout(drain);
        await client.close();
        store.close();
        process.exit(0);
      });
    });
}
