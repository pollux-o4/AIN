// 편집 서비스 백그라운드 기동·종료·상태 · `mise run editorial:<start|stop|restart|status>` · OPS-001
import { execFileSync, spawn } from "node:child_process";
import { openSync, readdirSync, readFileSync, readlinkSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { activeRuns, isStale, ownedRole } from "./lifecycle.mjs";

const root = resolve(".");
const local = join(root, ".local/ai-runtime");
const SESSION_URL = "http://127.0.0.1:3230/write/session";
const CODE_DIRS = [
  "automation/cli",
  "automation/contracts",
  "automation/editorial",
  "automation/n8n",
  "automation/paseo",
  "automation/runtime",
];
const SKIP = new Set(["tests", "ui", "node_modules"]);

function processes() {
  const ticks = Number(execFileSync("getconf", ["CLK_TCK"]).toString());
  const boot = Number(/btime (\d+)/.exec(readFileSync("/proc/stat", "utf8"))[1]) * 1000;
  const found = [];
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
      const role = ownedRole({ cwd: readlinkSync(`/proc/${pid}/cwd`), cmdline }, root);
      if (!role) continue;
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const startTicks = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
      found.push({ pid: Number(pid), role, startedAt: boot + (startTicks / ticks) * 1000 });
    } catch {
      // 조회 중 종료된 프로세스·권한 없는 프로세스는 소유 대상이 아님
    }
  }
  return found;
}

function codeChangedAt(dir = root, rel = CODE_DIRS) {
  let latest = 0;
  for (const entry of rel) {
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory())
      latest = Math.max(
        latest,
        codeChangedAt(
          path,
          readdirSync(path).filter((name) => !SKIP.has(name)),
        ),
      );
    else if (entry.endsWith(".mjs")) latest = Math.max(latest, info.mtimeMs);
  }
  return latest;
}

function runningJobs() {
  try {
    const db = new DatabaseSync(join(local, "editorial.sqlite"), { readOnly: true });
    try {
      return activeRuns(
        db
          .prepare("SELECT value FROM editorial_runs")
          .all()
          .map((r) => JSON.parse(r.value)),
      );
    } finally {
      db.close();
    }
  } catch (error) {
    if (/unable to open|no such table/.test(error.message)) return [];
    throw error;
  }
}

async function ready() {
  try {
    return (await fetch(SESSION_URL, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function status() {
  const procs = processes();
  const bridge = procs.find((p) => p.role === "bridge");
  return { procs, bridge, stale: bridge ? isStale(bridge.startedAt, codeChangedAt()) : false };
}

function refuseIfJobs(force) {
  const jobs = runningJobs();
  if (!jobs.length || force) return;
  const list = jobs.map((j) => `  ${j.id} ${j.idea}`).join("\n");
  throw new Error(
    `AI 작업이 진행 중이라 종료하지 않습니다:\n${list}\n완료를 기다리거나 \`mise run ain -- pause <id>\` 후 다시 실행하세요. 강제: --force`,
  );
}

async function stop({ force }) {
  refuseIfJobs(force);
  const targets = processes();
  if (!targets.length) return console.log("실행 중인 편집 서비스가 없습니다.");
  // 감독 프로세스 먼저: 자식 정리를 맡기고, 남은 프로세스는 직접 종료
  for (const role of ["supervisor", "bridge", "n8n"])
    for (const p of targets.filter((t) => t.role === role))
      try {
        process.kill(p.pid, "SIGTERM");
      } catch {}
  for (let i = 0; i < 60 && processes().length; i++) await wait(500);
  const left = processes();
  if (left.length)
    throw new Error(`종료되지 않은 프로세스: ${left.map((p) => `${p.role}(${p.pid})`).join(", ")}`);
  console.log("편집 서비스를 종료했습니다. (공통 Paseo 데몬은 유지)");
}

async function start({ force }) {
  const current = status();
  if (current.bridge && !current.stale && (await ready()))
    return console.log("이미 실행 중입니다: http://localhost:3230/write/");
  if (current.procs.length) {
    console.log(
      current.stale
        ? "실행 중인 서비스가 현재 코드보다 오래돼 다시 시작합니다."
        : "응답 없는 서비스를 정리합니다.",
    );
    await stop({ force });
  }
  execFileSync("pnpm", ["build"], { stdio: ["ignore", "ignore", "inherit"] });
  const log = openSync(join(local, "editorial-background.log"), "a", 0o600);
  const child = spawn(process.execPath, ["automation/runtime/start.mjs"], {
    cwd: root,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  for (let i = 0; i < 240; i++) {
    if (await ready()) {
      console.log("글쓰기: http://localhost:3230/write/\n종료: mise run editorial:stop");
      return;
    }
    if (child.exitCode !== null) break;
    await wait(500);
  }
  throw new Error("시작 실패: .local/ai-runtime/editorial-background.log 확인");
}

async function report() {
  const { procs, stale } = status();
  if (!procs.length) return console.log("상태: 중지");
  console.log(
    `상태: ${(await ready()) ? "실행 중" : "응답 없음"}${stale ? " · 이전 코드 (restart 필요)" : ""}`,
  );
  for (const p of procs)
    console.log(`  ${p.role} pid ${p.pid} · 시작 ${new Date(p.startedAt).toLocaleString("ko-KR")}`);
  const jobs = runningJobs();
  console.log(jobs.length ? `진행 중 AI 작업 ${jobs.length}건` : "진행 중 AI 작업 없음");
}

const [command, ...flags] = process.argv.slice(2);
const options = { force: flags.includes("--force") };
const commands = {
  start: () => start(options),
  stop: () => stop(options),
  restart: async () => {
    await stop(options);
    await start(options);
  },
  status: report,
};
try {
  if (!commands[command])
    throw new Error("사용법: control.mjs <start|stop|restart|status> [--force]");
  await commands[command]();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
