import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { RUNTIME_PROTOCOL } from "../contracts/runtime.mjs";
import { activeIntents, assertGoData, assertLegacyData } from "./go/database.mjs";
import {
  imageOf,
  legacyWriter,
  matchesProcess,
  ownsListener,
  processIdentity,
  readProcess,
} from "./go/process.mjs";
import { config, root, sourceStamp } from "./go/settings.mjs";

const commands = new Set([
  "foreground",
  "start",
  "stop",
  "restart",
  "status",
  "prune",
  "providers",
  "legacy-foreground",
  "legacy-bridge",
  "legacy-start",
  "legacy-stop",
  "legacy-restart",
  "legacy-status",
]);
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    interrupted = true;
  });

function privateFile(path, flags) {
  const fd = openSync(path, flags | constants.O_NOFOLLOW, 0o600);
  const file = fstatSync(fd);
  if (!file.isFile() || (file.mode & 0o077) !== 0) {
    closeSync(fd);
    throw Error("실행 제어 파일은 비공개 일반 파일이어야 합니다.");
  }
  return fd;
}

async function withLock(cfg, perform) {
  mkdirSync(cfg.control, { recursive: true, mode: 0o700 });
  const folder = lstatSync(cfg.control);
  if (!folder.isDirectory() || (folder.mode & 0o077) !== 0)
    throw Error("실행 제어 디렉터리는 비공개 일반 디렉터리여야 합니다.");
  const path = join(cfg.control, "control.lock");
  closeSync(privateFile(path, constants.O_CREAT | constants.O_WRONLY));
  const lock = spawn(
    "flock",
    [
      "--exclusive",
      "--wait",
      "5",
      "--close",
      path,
      process.execPath,
      "-e",
      'process.stdout.write("locked"); process.stdin.resume()',
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  lock.stdin.on("error", () => {});
  const closed = once(lock, "close");
  try {
    const ready = await Promise.race([
      once(lock.stdout, "data").then(([data]) => String(data)),
      closed.then(() => ""),
    ]);
    if (ready !== "locked") throw Error("다른 명령이 편집 서비스를 제어 중입니다.");
    return await perform();
  } finally {
    lock.stdin.end();
    await closed;
  }
}

function current(cfg) {
  const record = readProcess(cfg);
  if (record && record.data !== cfg.data)
    throw Error("이 제어 디렉터리는 다른 AIN_DATA_DIR의 서비스가 사용 중입니다.");
  return record;
}

function refuseLegacy(cfg) {
  const pid = legacyWriter(cfg.data);
  if (pid)
    throw Error(
      `이전 Node 작성자(pid ${pid})가 이 데이터 경로를 사용 중입니다. 기존 편집 서비스를 정상 종료해 주세요.`,
    );
}

async function assertPortFree(cfg) {
  const guard = createServer();
  try {
    await new Promise((resolve, reject) =>
      guard.once("error", reject).listen(cfg.port, "127.0.0.1", resolve),
    );
  } catch {
    throw Error(`편집 주소 ${cfg.listen}를 다른 서비스가 사용 중입니다.`);
  } finally {
    if (guard.listening) await new Promise((resolve) => guard.close(resolve));
  }
}

async function ready(record) {
  if (!ownsListener(record)) return false;
  try {
    const result = await fetch(`http://${record.listen}/healthz`, {
      signal: AbortSignal.timeout(750),
    });
    return (
      result.ok && (await result.json()).protocol === RUNTIME_PROTOCOL && matchesProcess(record)
    );
  } catch {
    return false;
  }
}

function runTask(task) {
  const result = spawnSync("mise", ["run", task], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw Error(`${task} 작업을 완료하지 못했습니다.`);
}

function freshArtifact(path, stamp) {
  try {
    const file = statSync(path);
    return file.isFile() && file.mtimeMs >= stamp;
  } catch {
    return false;
  }
}

function build(cfg, stamp) {
  if (!cfg.assetsOverride && !freshArtifact(join(cfg.assets, "index.html"), stamp.assets))
    runTask("build");
  if (!cfg.binaryOverride && !freshArtifact(cfg.binary, stamp.binary)) runTask("go:build");
  if (!existsSync(join(cfg.assets, "index.html")) || !existsSync(cfg.binary))
    throw Error("Go 실행 파일과 편집 화면 자산이 필요합니다. mise run setup으로 준비해 주세요.");
}

function recordProcess(cfg, record) {
  const temp = join(cfg.control, `process-${randomUUID()}.json`);
  try {
    writeFileSync(temp, JSON.stringify(record), { mode: 0o600, flag: "wx" });
    renameSync(temp, cfg.pidFile);
  } finally {
    rmSync(temp, { force: true });
  }
}

function outdated(cfg, record, stamp) {
  return (
    JSON.stringify(record.args) !== JSON.stringify(cfg.args) ||
    ["binary", "assets"].some((key) => stamp[key] !== record.stamp[key]) ||
    !existsSync(cfg.binary) ||
    record.image !== imageOf(cfg.binary)
  );
}

async function stop(cfg, force, selected = current(cfg)) {
  if (!selected || !matchesProcess(selected)) {
    const pid = legacyWriter(cfg.data);
    if (pid)
      console.log(`이전 Node 작성자(pid ${pid}) 실행 중 · Go 편집 서비스는 중지 상태입니다.`);
    else console.log("Go 편집 서비스가 실행 중이지 않습니다.");
    return;
  }
  const active = force ? 0 : activeIntents(cfg.data);
  if (active > 0)
    throw Error(
      `영속 AI 작업 ${active}건이 남아 있어 종료하지 않습니다. 완료를 기다리거나 --force로 연결을 보존한 채 종료하세요.`,
    );
  if (matchesProcess(selected)) process.kill(selected.pid, "SIGTERM");
  for (let i = 0; i < 120 && matchesProcess(selected); i++) await delay(250);
  if (matchesProcess(selected))
    throw Error(`편집 서비스(pid ${selected.pid})가 종료되지 않았습니다.`);
  rmSync(cfg.pidFile, { force: true });
  console.log("Go 편집 서비스를 종료했습니다.");
}

async function start(cfg, force) {
  refuseLegacy(cfg);
  assertGoData(cfg.data);
  const previous = current(cfg);
  const stamp = sourceStamp(cfg);
  if (previous && !outdated(cfg, previous, stamp) && (await ready(previous))) {
    console.log(`이미 실행 중입니다: ${cfg.origin}/write/`);
    return null;
  }
  if (previous) await stop(cfg, force, previous);
  await assertPortFree(cfg);
  build(cfg, stamp);
  refuseLegacy(cfg);
  assertGoData(cfg.data);
  if (interrupted) return null;
  const file = privateFile(cfg.log, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND);
  let child;
  try {
    child = spawn(cfg.binary, cfg.args, {
      cwd: root,
      detached: true,
      stdio: ["ignore", file, file],
    });
    await once(child, "spawn");
  } finally {
    closeSync(file);
  }
  child.unref();
  const identity = processIdentity(child.pid);
  if (!identity || identity.image !== imageOf(cfg.binary))
    throw Error("Go 시작에 실패했습니다. editorial.log를 확인해 주세요.");
  const record = {
    pid: child.pid,
    ticks: identity.ticks,
    image: identity.image,
    binary: cfg.binary,
    listen: cfg.listen,
    data: cfg.data,
    args: cfg.args,
    stamp: sourceStamp(cfg),
  };
  if (!matchesProcess(record)) throw Error("시작한 Go 프로세스의 소유권을 확인하지 못했습니다.");
  try {
    recordProcess(cfg, record);
  } catch (error) {
    if (matchesProcess(record)) process.kill(record.pid, "SIGTERM");
    throw error;
  }
  for (let i = 0; i < 80 && matchesProcess(record) && !interrupted; i++) {
    if (await ready(record)) {
      if (interrupted) break;
      console.log(`글쓰기: ${cfg.origin}/write/\n종료: mise run editorial:stop`);
      return record;
    }
    await delay(250);
  }
  if (matchesProcess(record)) await stop(cfg, true, record);
  else rmSync(cfg.pidFile, { force: true });
  if (interrupted) return null;
  throw Error(`Go 편집 서비스를 시작하지 못했습니다. ${cfg.log} 확인`);
}

async function status(cfg) {
  const active = current(cfg);
  if (!active) {
    const pid = legacyWriter(cfg.data);
    console.log(pid ? `상태: Go 중지 · 이전 Node 작성자 pid ${pid}` : "상태: 중지");
    return;
  }
  const stale = outdated(cfg, active, sourceStamp(cfg));
  console.log(
    `상태: ${(await ready(active)) ? "실행 중" : "응답 없음"} · Go pid ${active.pid}${stale ? " · 재시작 필요" : ""}`,
  );
  console.log(`영속 AI 작업 ${activeIntents(cfg.data)}건`);
}

function legacy(cfg, command, flags) {
  const mode = command.slice("legacy-".length);
  if (["start", "restart", "foreground", "bridge"].includes(mode)) {
    if (current(cfg)) throw Error("Go 편집 서비스가 이 데이터 경로를 사용 중입니다.");
    assertLegacyData(cfg.data);
  }
  const lookup = { foreground: "start.mjs", bridge: "server.mjs" };
  const args = lookup[mode] ? [] : [mode, ...flags];
  const result = spawnSync(
    process.execPath,
    [join(root, "automation/runtime", lookup[mode] ?? "control.mjs"), ...args],
    { cwd: root, stdio: "inherit" },
  );
  process.exitCode = result.status ?? 1;
}

async function main() {
  const [command, ...flags] = process.argv.slice(2);
  const permitted =
    command === "prune"
      ? ["--all", "--help", "-h"]
      : command === "providers"
        ? ["--help", "-h"]
        : ["--force"];
  if (!commands.has(command) || flags.some((flag) => !permitted.includes(flag)))
    throw Error("사용법: go-control.mjs <foreground|start|stop|restart|status> [--force]");
  const cfg = config();
  if (command === "prune" || command === "providers") {
    const options = command === "prune" ? ["--data", cfg.data] : ["--cwd", root];
    const result = spawnSync(
      "go",
      [
        "-C",
        "backend",
        "run",
        `./tools/${command}`,
        "--paseo-home",
        cfg.paseo,
        ...options,
        ...flags,
      ],
      { cwd: root, stdio: "inherit" },
    );
    process.exitCode = result.status ?? 1;
    return;
  }
  if (command.startsWith("legacy-")) return legacy(cfg, command, flags);
  if (command === "status") return status(cfg);
  const force = flags.includes("--force");
  const started = await withLock(cfg, async () => {
    if (command === "stop" || command === "restart") await stop(cfg, force);
    if (command !== "stop") return start(cfg, force);
    return null;
  });
  if (command !== "foreground" || !started) return;
  while (matchesProcess(started) && !interrupted) await delay(250);
  if (interrupted && matchesProcess(started)) await withLock(cfg, () => stop(cfg, true, started));
}

try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
