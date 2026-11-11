import { spawn } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RUNTIME_PROTOCOL } from "../contracts/runtime.mjs";
import { editorialWorkflow } from "../n8n/build-editorial-workflow.mjs";

const root = resolve(".local/ai-runtime");
await mkdir(root, { recursive: true, mode: 0o700 });
const children = [];
async function healthy(url) {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}
async function assertCompatibleBridge() {
  let response;
  try {
    response = await fetch("http://127.0.0.1:3230/healthz", { signal: AbortSignal.timeout(1000) });
  } catch {
    return;
  }
  const health = await response.json().catch(() => null);
  if (!response.ok || health?.protocol !== RUNTIME_PROTOCOL)
    throw new Error(
      "이전 편집 서비스가 실행 중입니다. 진행 중인 작업을 확인한 뒤 해당 서비스를 다시 시작해 주세요.",
    );
}
async function ensure(url, task, env = {}) {
  if (await healthy(url)) return;
  const log = await open(`${root}/${task.replaceAll(":", "-")}.log`, "a", 0o600);
  const child = spawn("mise", ["run", task], {
    env: { ...process.env, ...env },
    stdio: ["ignore", log.fd, log.fd],
  });
  children.push(child);
  await log.close();
  for (let i = 0; i < 90; i++) {
    if (await healthy(url)) return;
    if (child.exitCode !== null) throw new Error(`${task} 시작 실패: .local/ai-runtime 로그 확인`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${task} 시작 시간 초과`);
}
function stop() {
  for (const child of children) child.kill("SIGTERM");
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stop();
    process.exit(0);
  });
try {
  await assertCompatibleBridge();
  await ensure("http://127.0.0.1:6767/", "paseo");
  await ensure("http://127.0.0.1:5678/healthz/readiness", "n8n");
  const account = JSON.parse(await readFile(".local/n8n/dev-account.json", "utf8"));
  const base = "http://127.0.0.1:5678/rest";
  const login = await fetch(`${base}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailOrLdapLoginId: account.email, password: account.password }),
  });
  if (!login.ok) throw new Error("로컬 n8n 계정 연결 실패");
  const headers = {
    "Content-Type": "application/json",
    cookie: login.headers
      .getSetCookie()
      .map((s) => s.split(";")[0])
      .join("; "),
  };
  const workflow = editorialWorkflow();
  let response = await fetch(`${base}/workflows/${workflow.id}`, { headers });
  if (response.status === 404) {
    const { active, versionId, tags, ...body } = workflow;
    response = await fetch(`${base}/workflows`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } else if (response.ok) {
    const current = (await response.json()).data;
    const changed =
      JSON.stringify(current.nodes) !== JSON.stringify(workflow.nodes) ||
      JSON.stringify(current.connections) !== JSON.stringify(workflow.connections);
    if (changed) {
      await writeFile(
        `${root}/editorial-workflow-backup-${Date.now()}.json`,
        JSON.stringify(current),
        { mode: 0o600 },
      );
      response = await fetch(`${base}/workflows/${workflow.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          nodes: workflow.nodes,
          connections: workflow.connections,
          name: workflow.name,
          expectedChecksum: current.checksum,
        }),
      });
    } else {
      response = new Response(JSON.stringify({ data: current }), { status: 200 });
    }
  }
  if (!response.ok) throw new Error("n8n 글쓰기 흐름 준비 실패");
  const saved = (await response.json()).data;
  response = await fetch(`${base}/workflows/${saved.id}/activate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ versionId: saved.versionId, expectedChecksum: saved.checksum }),
  });
  if (!response.ok) throw new Error("n8n 글쓰기 흐름 활성화 실패");
  await ensure("http://127.0.0.1:3230/healthz", "ai:bridge");
  if (!(await healthy("http://127.0.0.1:3230/write/session")))
    throw new Error(
      "이전 편집 서비스가 실행 중입니다. 진행 중인 작업을 확인한 뒤 해당 서비스를 다시 시작해 주세요.",
    );
  console.log(
    "글쓰기: http://localhost:3230/write/\nn8n 관찰: http://localhost:5678/workflow/" +
      saved.id +
      "\n종료: Ctrl+C (이 명령으로 시작한 서버만 종료)",
  );
  await new Promise(() => {
    setInterval(() => {}, 60000);
  });
} catch (error) {
  console.error(
    error.code === "ENOENT" ? "로컬 n8n 개발 계정 설정을 찾을 수 없습니다." : error.message,
  );
  stop();
  process.exitCode = 1;
}
