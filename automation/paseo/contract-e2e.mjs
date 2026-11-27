import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AI_MODELS } from "../contracts/ai-models.mjs";
import { toTxt } from "../contracts/txt.mjs";
import { directionSchema, sectionMode, usesStoryCard } from "../contracts/writing-modes.mjs";
import { flowIssue, readerLength, requirements, STAGES } from "../editorial/domain/index.mjs";
import { scratchDir } from "../runtime/scratch.mjs";
import { liveCase } from "./live/cases.mjs";
import { requireLiveConsent } from "./live/consent.mjs";
import { buildProbe, runProbe } from "./live/go-probe.mjs";
import { draftMetrics } from "./metrics.mjs";

const ARTICLE_CALL_LIMIT = 30;
const readJSON = async (path) => JSON.parse(await readFile(path, "utf8"));

function projectQuality(run) {
  const { state } = run;
  const outline = state.artifacts.outline.output;
  const review = state.artifacts.review.output;
  const draft = state.artifacts.draft.output.text;
  const checks = Array.isArray(review.checks) ? review.checks : [];
  const requested = (run.events ?? []).filter(({ kind }) => kind === "ai_requested");
  return {
    characters: readerLength(draft),
    requirements: requirements(state),
    autoCorrections: state.autoCorrections ?? 0,
    callsByStage: Object.fromEntries(
      STAGES.map((stage) => [stage, requested.filter((event) => event.stage === stage).length]),
    ),
    storyCards: outline.sections.filter((section) => section?.hook).length,
    cardSections: outline.sections.filter((section) => usesStoryCard(sectionMode(section))).length,
    sections: outline.sections.length,
    metrics: draftMetrics(draft, { outline }),
    verdict: review.verdict ?? null,
    failedChecks: checks.filter((check) => !check.pass).map((check) => check.id),
    checks: checks.length,
  };
}

function usage(run, history) {
  // Output tokens are reported only where Paseo supplied that specific value.
  const outputs = (run.events ?? [])
    .filter(({ kind }) => kind === "ai_completed")
    .map(({ usage: observed }) => observed?.outputTokens)
    .filter((count) => Number.isSafeInteger(count) && count >= 0);
  return {
    ...history.usage,
    total: { outputTokens: outputs.length ? outputs.reduce((sum, count) => sum + count, 0) : null },
  };
}

function liveBudget({ article, pilot }) {
  if (!article) return "연결 확인 최대 1회";
  const calls = ARTICLE_CALL_LIMIT * (process.env.CONTRACT_FEEDBACK ? 2 : 1);
  return `${pilot ? "연결 확인 최대 1회, " : ""}합성 글의 모델 호출 최대 ${calls}회`;
}

export async function runLiveVerification({
  article = true,
  pilot = true,
  live = liveCase("narrate"),
  quiet = false,
} = {}) {
  requireLiveConsent(liveBudget({ article, pilot }));
  const scratch = await scratchDir("contract-live");
  const root = join(scratch.path, "trial");
  const binary = join(scratch.path, "liveprobe");
  const reportPath = join(scratch.path, "report.json");
  const report = {
    result: "failed",
    phase: "setup",
    directory: scratch.path,
    model: `${AI_MODELS.standard.provider}/${AI_MODELS.standard.model}`,
    pilotCalls: 0,
    articleCalls: 0,
    published: false,
    cleanupIssues: [],
    ...(article ? { case: live.id } : {}),
  };
  try {
    await mkdir(root, { mode: 0o700 });
    const [mode, readerLevel] = (process.env.CONTRACT_DIRECTION ?? "").split(":");
    const chosen = process.env.CONTRACT_DIRECTION ? { mode, readerLevel } : live.direction;
    const direction = chosen ? directionSchema.parse(chosen) : undefined;
    await buildProbe(binary);
    const { status, result } = await runProbe(binary, {
      root,
      pilot,
      article,
      standard: selectModel(AI_MODELS.standard),
      high: selectModel(AI_MODELS.high),
      ...(article
        ? {
            input: {
              requestId: `contract-${randomUUID()}`,
              idea: live.idea,
              source: live.source,
              ...(direction ? { direction } : {}),
            },
            feedback: process.env.CONTRACT_FEEDBACK || "",
          }
        : {}),
    });
    if (result) Object.assign(report, result);
    if (status !== 0 || !result || report.cleanupIssues.length)
      throw new Error("Go live probe did not finish cleanly");
    if (article) {
      const run = await readJSON(join(root, "run.json"));
      const history = await readJSON(join(root, "history.json"));
      assert.equal(flowIssue(run.state), null);
      assert.equal(run.state.status, "awaiting_user");
      if (direction) {
        assert.equal(run.state.direction.mode, direction.mode);
        assert.equal(run.state.direction.readerLevel, direction.readerLevel);
      }
      const articlePath = join(root, "article.txt");
      assert.deepEqual(
        await readFile(articlePath),
        Buffer.from(toTxt(run.state.artifacts.draft.output.text), "utf8"),
      );
      Object.assign(report, {
        quality: projectQuality(run),
        usage: usage(run, history),
        workers: { reused: result.reused, created: result.created },
        revision: run.state.revision,
        status: run.state.status,
        stages: STAGES,
        articlePath,
      });
    }
    report.result = "passed";
  } catch (error) {
    report.failureCode = error.code ?? error.name;
  } finally {
    await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600, flag: "wx" });
    await scratch.release({ failed: report.result !== "passed" });
  }
  if (report.result !== "passed") {
    throw Object.assign(
      new Error(`Live verification failed (${report.phase}); report: ${reportPath}`),
      { report },
    );
  }
  if (!quiet) console.log(JSON.stringify(report));
  return report;
}

const selectModel = ({ provider, model, thinking }) => ({ provider, model, thinking });

export async function liveVerificationCli(options) {
  const args = process.argv.slice(2);
  if (args.length) {
    const help = args.length === 1 && ["--help", "-h"].includes(args[0]);
    console[help ? "log" : "error"](
      `추가 인자 없이 실행하세요. ${liveBudget({ article: options?.article ?? true, pilot: true })}.`,
    );
    if (!help) process.exitCode = 1;
    return;
  }
  try {
    await runLiveVerification(options);
  } catch (error) {
    console.error(error.message);
    process.exitCode ||= 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await liveVerificationCli();
}
