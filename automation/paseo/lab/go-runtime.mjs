import { execFileSync, spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve, sep } from "node:path";
import { LAB_ROOT } from "./store.mjs";

export function labData(parent, variant, source) {
  const base = resolve(LAB_ROOT);
  const target = resolve(parent, variant);
  if (resolve(source) === target || !target.startsWith(base + sep))
    throw new Error("연구소 데이터는 실사용 저장소와 다른 .local/figure-lab 하위 경로에 둡니다.");
  let dir = dirname(base);
  for (const part of ["figure-lab", ...target.slice(base.length + 1).split(sep)]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (realpathSync(dir) !== dir)
      throw new Error("연구소 데이터 경로에서 심볼릭 링크를 사용할 수 없습니다.");
    dir = join(dir, part);
  }
  mkdirSync(dir, { mode: 0o700, recursive: true });
  if (realpathSync(dir) !== dir)
    throw new Error("연구소 데이터 경로에서 심볼릭 링크를 사용할 수 없습니다.");
  if (realpathSync(source) === target) throw new Error("연구소와 원본 저장소를 분리해 주세요.");
  return target;
}

export function buildTool(dir, executable, pkg) {
  const path = join(dir, executable);
  execFileSync("go", ["-C", "backend", "build", "-o", path, pkg], { stdio: "inherit" });
  return path;
}

export function fixture(tool, operation, args, env = process.env) {
  const flags = Object.entries(args).flatMap(([key, value]) => [`--${key}`, String(value)]);
  return JSON.parse(
    execFileSync(tool, [operation, ...flags], {
      encoding: "utf8",
      env,
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
}

export async function startGo({
  executable,
  runtimeDir,
  assets,
  url,
  policy,
  model,
  reviewThinking,
  paseoHome,
  signal,
}) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    !parsed.port ||
    parsed.origin !== url.replace(/\/$/, "")
  ) {
    throw new Error("연구소 URL은 포트를 명시한 로컬 HTTP 주소여야 합니다.");
  }
  await new Promise((done, fail) => {
    const server = createServer();
    server.once("error", () => fail(new Error(`연구소 포트 ${parsed.port}가 이미 사용 중입니다.`)));
    server.listen(Number(parsed.port), parsed.hostname, () => server.close(done));
  });

  const file = join(runtimeDir, `policy-${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify(policy), { mode: 0o600, flag: "wx" });
  const log = openSync(join(runtimeDir, "server.log"), "a", 0o600);
  const sessionKey = randomBytes(32).toString("hex");
  let child;
  try {
    signal?.throwIfAborted();
    child = spawn(
      executable,
      [
        "--listen",
        parsed.host,
        "--data",
        runtimeDir,
        "--assets",
        assets,
        "--paseo-home",
        paseoHome,
        "--provider",
        model.provider,
        "--model",
        model.model,
        "--thinking",
        model.thinking,
        "--review-thinking",
        reviewThinking,
        "--lab-policy",
        file,
      ],
      {
        env: {
          ...process.env,
          AIN_LIVE: "1",
          AIN_SESSION_KEY: sessionKey,
          AIN_AGENT_TOKEN: randomBytes(32).toString("hex"),
        },
        stdio: ["ignore", log, log],
      },
    );
    child.once("error", () => {});
    const expected =
      "editorial-session=" +
      createHmac("sha256", sessionKey).update("ain-editorial-ui").digest("hex");
    return { child, file, expected };
  } catch (err) {
    if (child) await stopGo(child);
    rmSync(file, { force: true });
    throw err;
  } finally {
    closeSync(log);
  }
}

export async function stopGo(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  await new Promise((done) => {
    const forced = setTimeout(() => child.kill("SIGKILL"), 7000);
    child.once("exit", () => {
      clearTimeout(forced);
      done();
    });
    child.kill("SIGTERM");
  });
}
