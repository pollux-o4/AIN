import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { AI_MODELS } from "../../contracts/ai-models.mjs";
import { paseoHome } from "../../contracts/paseo-home.mjs";
import { DEFAULT_RUNTIME_URL, LIVE_RUNTIME_DIR } from "../../contracts/runtime.mjs";
import { requireLiveConsent } from "../live/consent.mjs";
import { createHttpSession, drive, fix } from "./drive.mjs";
import { importGoReport } from "./go-report.mjs";
import { buildTool, fixture, labData, startGo, stopGo } from "./go-runtime.mjs";
import { LAB_ROOT } from "./store.mjs";
import { objectPolicy } from "./variants.mjs";

async function waitForSession(url, server, signal) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    signal.throwIfAborted();
    if (server.child.exitCode !== null || server.child.signalCode !== null || !server.child.pid)
      throw new Error("연구소 Go 서버가 시작되지 않았습니다. 연구소 server.log를 확인해 주세요.");
    try {
      return await createHttpSession(url, { expectedCookie: server.expected });
    } catch {
      await delay(200, undefined, { signal });
    }
  }
  throw new Error("연구소 Go 서버 시작 시간 초과");
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
      looks: { type: "string", default: "" },
      feedback: { type: "string" },
      url: { type: "string", default: DEFAULT_RUNTIME_URL },
      source: { type: "string", default: process.env.AIN_DATA_DIR || LIVE_RUNTIME_DIR },
      runtime: { type: "string", default: join(LAB_ROOT, "runtime") },
    },
    strict: true,
  }).values;
}

const split = (value) => (value ? value.split(",").map((item) => item.trim()) : []);
const knownLooks = ["anatomy", "sketchnote", "tablet", "stick", "manual"];
const caseIdPattern = /^[a-z0-9][a-z0-9-]{0,39}$/;

export async function main() {
  const options = parse();
  requireLiveConsent(`RES-009 ${options.trials}회 위치 제안과 그림 생성`);
  if (!options.from || !options.case || !options.variant)
    throw new Error(
      "사용법: lab:run -- --from <글 id 앞부분> --case <사례> --variant <id> [--trials 3] [--stage plan|compose|figure|fix] [--figures f2,f3]",
    );
  const policy = objectPolicy(options.variant);
  const trials = Number(options.trials);
  const { stage } = options;
  if (!Number.isInteger(trials) || trials < 1) throw new Error("--trials는 양의 정수여야 합니다.");
  if (!["plan", "compose", "figure", "fix"].includes(stage))
    throw new Error("--stage는 plan·compose·figure·fix 가운데 하나여야 합니다.");
  const figures = split(options.figures);
  const looks = split(options.looks);
  if (new Set(figures).size !== figures.length || figures.some((id) => !/^f[1-9][0-9]?$/.test(id)))
    throw new Error("--figures에 알 수 없거나 중복된 그림 id가 있습니다.");
  if (new Set(looks).size !== looks.length || looks.some((look) => !knownLooks.includes(look)))
    throw new Error("--looks에 알 수 없거나 중복된 그림 스타일이 있습니다.");
  if (
    stage === "fix" &&
    (trials !== 1 || figures.length !== 1 || looks.length || !options.feedback?.trim())
  )
    throw new Error(
      "fix는 --trials 1, 단일 --figures, --feedback과 연구소 글 id 전체가 필요합니다.",
    );
  if (stage !== "plan" && !figures.length) throw new Error("--figures에 그림 id를 적어 주세요.");
  const cases = looks.length ? looks.map((look) => `${options.case}-${look}`) : [options.case];
  if (
    cases.some(
      (id) =>
        !caseIdPattern.test(id) ||
        ((stage === "figure" || stage === "fix") &&
          figures.some((figure) => !caseIdPattern.test(`${id}-${figure}`))),
    )
  )
    throw new Error("사례 id는 소문자·숫자·하이픈 40자 이내여야 합니다.");
  const assets = resolve(process.env.AIN_ASSETS || ".local/editorial-web");
  if (!existsSync(join(assets, "index.html")))
    throw new Error("먼저 mise run build를 실행해 주세요.");
  const home = paseoHome();
  const runtimeDir = labData(options.runtime, options.variant, options.source);
  const ref =
    execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim() +
    (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() ? "-dirty" : "");
  const scratch = mkdtempSync(join(tmpdir(), "ain-lab-go-"));
  const controller = new AbortController();
  const onSignal = (name) => {
    process.exitCode = name === "SIGINT" ? 130 : 143;
    controller.abort(new Error(`파일럿 중단 (${name})`));
  };
  const onInt = () => onSignal("SIGINT");
  const onTerm = () => onSignal("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const model = AI_MODELS.standard;
  try {
    const tool = buildTool(scratch, "labfixture", "./tools/labfixture");
    const executable = buildTool(scratch, "ain", "./cmd/ain");
    for (let trial = 1; trial <= trials; trial += 1) {
      controller.signal.throwIfAborted();
      const ids =
        stage === "fix"
          ? [options.from]
          : fixture(
              tool,
              "seed",
              {
                source: resolve(options.source),
                data: runtimeDir,
                from: options.from,
                stage,
                count: cases.length,
                variant: options.variant,
                provider: model.provider,
                model: model.model,
                thinking: model.thinking,
              },
              { ...process.env, AIN_LIVE: "1" },
            );
      if (stage === "fix") {
        if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(ids[0]))
          throw new Error("fix는 연구소 글 id 전체가 필요합니다.");
        const { lab } = fixture(tool, "report", { source: runtimeDir, from: ids[0] });
        if (
          lab?.variant !== options.variant ||
          lab.provider !== model.provider ||
          lab.model !== model.model ||
          lab.thinking !== model.thinking
        )
          throw new Error("기존 회차와 동일한 변형·제공자·모델·사고 단계가 필요합니다.");
      }
      const server = await startGo({
        executable,
        runtimeDir,
        assets,
        url: options.url,
        policy,
        model,
        reviewThinking: AI_MODELS.high.thinking,
        paseoHome: home,
        signal: controller.signal,
      });
      try {
        const http = await waitForSession(options.url, server, controller.signal);
        const results = await Promise.allSettled(
          ids.map(async (articleId, i) => {
            const signal = controller.signal;
            if (i) await delay(i * 4000, undefined, { signal });
            if (stage === "fix") {
              await fix({
                http,
                articleId,
                figure: figures[0],
                feedback: options.feedback.trim(),
                signal,
              });
            } else {
              await drive({ http, articleId, stage, figures, look: looks[i], signal });
            }
            return { articleId, caseId: cases[i] };
          }),
        );
        const failed = [];
        for (const [index, result] of results.entries()) {
          try {
            if (result.status === "rejected") throw result.reason;
            const { articleId, caseId } = result.value;
            const records = await importGoReport({
              report: fixture(tool, "report", { source: runtimeDir, from: articleId }),
              caseId,
              variant: options.variant,
              trial,
              ref,
            });
            if (!records.some((record) => record.stage === (stage === "fix" ? "figure" : stage)))
              throw new Error(`회차 ${trial}: ${stage} 기록을 만들지 못했습니다 (${articleId}).`);
          } catch (error) {
            failed.push(`${cases[index]}: ${error.message}`);
          }
        }
        if (failed.length) throw new Error(`회차 ${trial} 실패\n${failed.join("\n")}`);
        console.log(`회차 ${trial}/${trials} 기록 완료 (${ids.join(", ")})`);
      } finally {
        await stopGo(server.child);
        rmSync(server.file, { force: true });
      }
    }
  } finally {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode ||= 1;
  }
}
