import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, openSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { DATA_DIR_ENV, DEFAULT_RUNTIME_URL } from "../../contracts/runtime.mjs";
import { EditorialStore } from "../../editorial/index.mjs";
import { requireLiveConsent } from "../live/consent.mjs";
import { createHttpSession, drive, fix } from "./drive.mjs";
import { importArticle } from "./import.mjs";
import { labRuntime, seedFromArticle } from "./seed.mjs";
import { LAB_ROOT, writeLabIndex } from "./store.mjs";
import { LAB_VARIANTS, objectPolicy } from "./variants.mjs";

async function assertPortFree(url) {
  const { port, hostname } = new URL(url);
  await new Promise((resolveListen, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(new Error(`브리지 포트 ${port}에서 실행 중인 서비스가 있습니다.`)),
    );
    server.listen(Number(port), hostname, () => server.close(resolveListen));
  });
}

async function startBridge(variant, url, runtimeDir) {
  await assertPortFree(url);
  mkdirSync(LAB_ROOT, { recursive: true, mode: 0o700 });
  const log = openSync(join(LAB_ROOT, "bridge.log"), "a");
  const child = spawn(process.execPath, ["automation/runtime/server.mjs"], {
    env: { ...process.env, AIN_LAB_VARIANT: variant, [DATA_DIR_ENV]: runtimeDir },
    // 브리지가 실행 중에 죽으면 원인을 남긴다 · 원문은 서버가 기록하지 않음
    stdio: ["ignore", log, log],
  });
  child.on("error", () => {});
  child.on("exit", (code, signal) =>
    appendFileSync(
      join(LAB_ROOT, "bridge.log"),
      `${new Date().toISOString()} 브리지 종료 code=${code} signal=${signal}\n`,
    ),
  );
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.exitCode !== null) throw new Error("편집 서버 브리지가 시작되지 않았습니다.");
      try {
        const response = await fetch(`${new URL(url).origin}/healthz`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) return child;
      } catch {
        // 서버 준비 전 연결 실패는 다음 확인 주기에 재시도한다.
      }
      await new Promise((done) => setTimeout(done, 200));
    }
    throw new Error("편집 서버 브리지 시작 시간 초과");
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}

async function stopBridge(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((done) => child.once("exit", done)),
    new Promise((done) =>
      setTimeout(() => {
        child.kill("SIGKILL");
        done();
      }, 5000),
    ),
  ]);
}

function parse() {
  return parseArgs({
    options: {
      from: { type: "string" },
      case: { type: "string" },
      variant: { type: "string" },
      trials: { type: "string", default: "3" },
      stage: { type: "string", default: "plan" },
      figures: { type: "string", default: "" },
      // 그림 스타일 비교 · 스타일마다 글을 하나씩 시드해 한 브리지에서 동시에 돌린다 · ADR-0027
      looks: { type: "string", default: "" },
      feedback: { type: "string" },
      url: { type: "string", default: DEFAULT_RUNTIME_URL },
      // 실험 글은 연구소 저장소에만 · 실사용 목록에 복제본이 쌓이지 않게 한다(LAB-001)
      runtime: { type: "string", default: join(LAB_ROOT, "runtime") },
    },
    strict: true,
  }).values;
}

export async function main() {
  const options = parse();
  requireLiveConsent(`RES-009 ${options.trials ?? 3}회 위치 제안과 그림 생성`);
  if (!options.from || !options.case || !options.variant)
    throw new Error(
      "사용법: node automation/paseo/lab/run.mjs --from <글 id 앞부분> --case <사례 앞이름> --variant <id> --trials 3 [--stage plan|compose|figure] [--figures f2,f3,f4] · compose·figure는 위치 후보 선택 대기 글에서 시작",
    );

  objectPolicy(options.variant);
  const trials = Number(options.trials);
  if (!Number.isInteger(trials) || trials < 1) throw new Error("--trials는 양의 정수여야 합니다.");
  if (!["plan", "compose", "figure", "fix"].includes(options.stage))
    throw new Error("--stage는 plan·compose·figure·fix 가운데 하나여야 합니다.");
  // fix: --from은 확인 대기 중인 연구소 글 id 전체 · 그림 하나에 --feedback 지적 · ADR-0026
  if (options.stage === "fix" && (trials !== 1 || !options.feedback?.trim()))
    throw new Error("fix는 --trials 1과 --feedback이 필요합니다.");
  const figures = options.figures
    ? options.figures
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : [];
  if (new Set(figures).size !== figures.length) throw new Error("--figures에 중복 id가 있습니다.");
  const runtimeDir = labRuntime(options.runtime);
  const jobsDir = resolve(runtimeDir, "jobs");
  const url = options.url;
  const ref = `${execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()}${
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() ? "-dirty" : ""
  }`;
  const controller = new AbortController();
  const onSignal = (name) => {
    process.exitCode = name === "SIGINT" ? 130 : 143;
    controller.abort(new Error(`파일럿 중단 (${name})`));
  };
  const onInt = () => onSignal("SIGINT");
  const onTerm = () => onSignal("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  let bridge;
  try {
    bridge = await startBridge(options.variant, url, runtimeDir);
    const http = await createHttpSession(url);
    const runOne = async (look, trial) => {
      // 구성·생성 실험은 모든 회차가 같은 위치 후보에서 출발해야 변수가 대상 정책 하나로 남는다 · ADR-0026
      const articleId =
        options.stage === "fix"
          ? options.from
          : seedFromArticle({
              runtimeDir,
              fromArticle: options.from,
              from: options.stage === "plan" ? "satisfied" : "choice",
            }).articleId;
      if (options.stage === "fix") {
        if (figures.length !== 1) throw new Error("fix는 --figures에 그림 하나를 적습니다.");
        await fix({
          http,
          articleId,
          figure: figures[0],
          feedback: options.feedback.trim(),
          signal: controller.signal,
        });
      } else
        await drive({
          http,
          articleId,
          stage: options.stage,
          figures,
          look,
          signal: controller.signal,
        });
      const store = new EditorialStore(resolve(runtimeDir, "editorial.sqlite"));
      let state;
      try {
        state = store.get(articleId)?.state;
      } finally {
        store.close();
      }
      const records = await importArticle({
        state,
        jobsDir,
        articleId,
        caseId: look ? `${options.case}-${look}` : options.case,
        variant: options.variant,
        trial,
        ref,
      });
      const wanted = ["figure", "fix"].includes(options.stage) ? "compose" : options.stage;
      if (!records.some((record) => record.stage === wanted))
        throw new Error(`회차 ${trial}: ${wanted} 기록을 만들지 못했습니다 (${articleId}).`);
      await writeLabIndex(LAB_ROOT, LAB_VARIANTS);
    };
    const looks = options.looks ? options.looks.split(",").map((look) => look.trim()) : [undefined];
    for (let trial = 1; trial <= trials; trial += 1) {
      // 동시 시작은 시드 복제·세션 생성이 몰려 브리지 연결이 끊긴다 · 몇 초씩 엇갈려 시작
      // 한 스타일이 실패해도 나머지는 끝까지 기록한다
      const results = await Promise.allSettled(
        looks.map((look, i) =>
          new Promise((done) => setTimeout(done, i * 4000)).then(() => runOne(look, trial)),
        ),
      );
      const failed = results.flatMap((result, i) =>
        result.status === "rejected" ? [`${looks[i] ?? "기본"}: ${result.reason?.message}`] : [],
      );
      if (failed.length) throw new Error(`회차 ${trial} 실패\n${failed.join("\n")}`);
      console.log(`회차 ${trial}/${trials} 기록 완료`);
    }
  } finally {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    if (bridge) await stopBridge(bridge);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
