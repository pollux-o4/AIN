import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { connectLocalPaseo } from "../../../paseo/sdk.mjs";
import { AI_MODELS, escalated } from "../contracts/ai-models.mjs";
import { toTxt } from "../contracts/txt.mjs";
import { directionSchema, sectionMode, usesStoryCard } from "../contracts/writing-modes.mjs";
import {
  flowIssue,
  readerLength,
  requirements,
  STAGES,
  transition,
} from "../editorial/domain/index.mjs";
import { EditorialService, EditorialStore } from "../editorial/index.mjs";
import { startIsolatedN8n } from "../n8n/testing/runtime.mjs";
import { scratchDir } from "../runtime/scratch.mjs";
import { makeServer } from "../runtime/server.mjs";
import { Jobs } from "./index.mjs";
import { liveCase } from "./live/cases.mjs";
import { requireLiveConsent } from "./live/consent.mjs";
import { draftMetrics } from "./metrics.mjs";
import { usageSummary } from "./usage.mjs";

const AI = {
  provider: AI_MODELS.standard.provider,
  model: AI_MODELS.standard.model,
  enabled: true,
  maxDurationMs: 300000, // 운영 요청 상한과 같게(OPS-003)
};
const terminal = (job) => ["completed", "failed"].includes(job.status);

// 실제 비용 호출은 명시적 실행 때만: 연결 확인 1회 성공 후 합성 글 1편, 대체 모델 없음.
// 글 호출 상한: 필수 8단계 + 구간별 초고·코드 거부에 따른 다시 쓰기·자동 재작성(ADR-0007·0009·0013)
const ARTICLE_CALL_LIMIT = 30;
const ARTICLE_DEADLINE_MS = 1800000;
// 연결 확인 한도: 새 세션 첫 호출 실측 38~49초(2026-11-14) · 45초 한도에서는 간헐 실패
const PILOT_RUN_MS = 90000;
const PILOT_DEADLINE_MS = 120000;
// 격리 n8n 포트: 반복 평가가 여러 실행을 나란히 돌릴 때 실행마다 다른 포트를 넘긴다
const N8N_PORT = 5738;
/**
 * @param {object} [options]
 * @param {boolean} [options.article] 거짓이면 연결 확인만
 * @param {boolean} [options.pilot] 거짓이면 연결 확인 생략(반복 평가가 한 번만 확인)
 * @param {import("./live/cases.mjs").LiveCase} [options.live] 쓸 글감 · 기본은 수필 사례
 * @param {number} [options.port] 격리 n8n 포트
 * @param {boolean} [options.quiet] 보고서를 표준 출력에 싣지 않음
 */
// shortcut: 준비·연결 확인·글 실행·정리가 한 함수에 있음, 실제 모델로 회귀 확인할 수 있을 때 단계별 함수로 분리
export async function runLiveVerification({
  article = true,
  pilot: runPilot = true,
  live = liveCase("narrate"),
  port = N8N_PORT,
  quiet = false,
} = {}) {
  assert.equal(typeof article, "boolean");
  assert.equal(STAGES.length, 8);
  // 통과한 실행은 보고를 표준 출력으로 남기고 폴더를 지운다 · 실패한 실행은 진단용으로 남김
  const scratch = await scratchDir("contract-live");
  const root = scratch.path;
  const controller = new AbortController();
  const { signal } = controller;
  const onSignal = (name) => {
    process.exitCode = name === "SIGINT" ? 130 : 143;
    controller.abort(new Error("Live verification interrupted"));
  };
  const onInt = () => onSignal("SIGINT");
  const onTerm = () => onSignal("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  let client, jobs, store, editorial, server, n8n;
  let failure;
  const cleanupIssues = [];
  const report = {
    result: "failed",
    phase: "setup",
    directory: root,
    model: `${AI.provider}/${AI.model}`,
    pilotCalls: 0,
    articleCalls: 0,
    published: false,
  };
  const ownedJobIds = async () => {
    let files;
    try {
      files = await readdir(join(root, "jobs"));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    return files
      .filter((file) => /^[a-f0-9]{64}\.json$/.test(file))
      .map((file) => file.slice(0, -5));
  };
  const readJobs = async () => Promise.all((await ownedJobIds()).map((id) => jobs.read(id)));
  const clean = async (label, fn) => {
    try {
      await fn();
    } catch {
      cleanupIssues.push(label);
    }
  };
  try {
    signal.throwIfAborted();
    const workRoot = join(root, "work");
    await mkdir(workRoot, { mode: 0o700 });
    client = await connectLocalPaseo();
    jobs = new Jobs({
      client,
      root: join(root, "jobs"),
      workRoot,
      allowedProviders: [AI.provider],
    });
    const create = jobs.create.bind(jobs);
    let calls = 0;
    let limit = 1;
    jobs.create = async (body) => {
      signal.throwIfAborted();
      const existing = await jobs.find(body);
      if (existing) return existing;
      signal.throwIfAborted();
      assert.ok(calls < limit, "Live verification call budget exceeded");
      calls += 1;
      if (report.phase === "pilot") report.pilotCalls += 1;
      else report.articleCalls += 1;
      return create(body);
    };
    const providers = await jobs.providers();
    assert.ok(
      providers.some(
        (entry) =>
          entry.provider === AI.provider &&
          entry.status === "ready" &&
          entry.models.some((model) => model.id === AI.model),
      ),
      "기본 제공자·모델 연결을 먼저 확인해 주세요.",
    );
    if (runPilot) {
      report.phase = "pilot";
      const marker = `contract-pilot-${randomBytes(12).toString("hex")}`;
      const state = transition(null, {
        id: marker,
        articleId: marker,
        actor: "user",
        type: "start",
        idea: "짧은 연결 확인",
      }).state;
      const pilot = await jobs.create({
        state,
        ai: { ...AI, pilot: true, maxDurationMs: PILOT_RUN_MS },
      });
      const pilotDeadline = Date.now() + PILOT_DEADLINE_MS;
      let checked = pilot;
      while (!terminal(checked) && !["needs_attention", "permission"].includes(checked.status)) {
        signal.throwIfAborted();
        assert.ok(Date.now() < pilotDeadline, "Pilot timed out");
        await delay(500, undefined, { signal });
        checked = await jobs.poll(pilot.id);
      }
      assert.equal(checked.status, "completed", "연결 확인 실패: 글 실행을 시작하지 않습니다.");
      assert.equal(checked.event.output.marker, marker);
      assert.equal((await readJobs()).length, 1);
    }
    signal.throwIfAborted();
    if (article) {
      report.phase = "article";
      // 수정 회차 검증 시 같은 상한을 한 번 더 허용한다.
      limit = calls + ARTICLE_CALL_LIMIT * (process.env.CONTRACT_FEEDBACK ? 2 : 1);
      report.case = live.id;
      const articleStarted = Date.now();
      const token = randomBytes(32).toString("hex");
      const n8nUrl = `http://127.0.0.1:${port}`;
      store = new EditorialStore(join(root, "editorial.sqlite"));
      editorial = new EditorialService({ store, jobs, ai: AI, dispatch: (id) => n8n.dispatch(id) });
      server = makeServer({ editorial, token, n8nUrl });
      await new Promise((done, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          done();
        });
      });
      signal.throwIfAborted();
      const n8nRoot = join(root, "n8n");
      await mkdir(n8nRoot, { mode: 0o700 });
      n8n = await startIsolatedN8n({
        root: n8nRoot,
        port,
        bridgeUrl: `http://127.0.0.1:${server.address().port}`,
        token,
      });
      signal.throwIfAborted();
      // 선택: CONTRACT_DIRECTION="mode:readerLevel"로 사용자 지정 경로 검증. 없으면 글감의 지정, 그것도 없으면 자동 경로.
      const [mode, readerLevel] = (process.env.CONTRACT_DIRECTION ?? "").split(":");
      const chosen = process.env.CONTRACT_DIRECTION ? { mode, readerLevel } : live.direction;
      const direction = chosen ? directionSchema.parse(chosen) : undefined;
      const started = await editorial.create({
        ...(direction ? { direction } : {}),
        requestId: `contract-${randomBytes(12).toString("hex")}`,
        idea: live.idea,
        source: live.source,
      });
      const deadline = Date.now() + ARTICLE_DEADLINE_MS;
      let view = editorial.get(started.id);
      while (view.status !== "awaiting_user") {
        signal.throwIfAborted();
        // 멈춘 곳과 까닭(서비스가 사용자에게 보여 주는 문구 · 제공자 원문 오류 아님)을 보고서에 남긴다
        if (view.issue || view.status === "failed")
          report.stopped = view.issue ?? store.get(started.id).state.error ?? view.status;
        assert.equal(view.issue, null, "글 실행에 확인이 필요합니다.");
        assert.notEqual(view.status, "failed", "글 실행이 실패했습니다.");
        assert.ok(Date.now() < deadline, "Article timed out");
        await delay(500, undefined, { signal });
        view = editorial.get(started.id);
      }
      assert.equal(view.issue, null);
      const run = store.get(started.id);
      const final = run.state;
      const articleJobs = (await readJobs()).filter((job) => job.state.articleId === started.id);
      if (direction) {
        const design = view.design;
        assert.equal(final.direction.mode, direction.mode);
        assert.equal(design.mode, direction.mode, "사용자 지정 서술 방식이 유지되지 않았습니다.");
        assert.equal(design.modeBy, "user");
        assert.equal(design.readerLevel, direction.readerLevel);
        assert.equal(design.levelBy, "user");
      }
      assert.deepEqual(
        [...new Set(articleJobs.map((job) => job.action.stage))].sort(),
        [...STAGES].sort(),
      );
      // 모델은 정책이 고른 것만: 기본, 그리고 검토·다시 쓰기의 상향 짝(ai-models가 원천)
      const allowedModels = [AI, escalated(AI)]
        .filter(Boolean)
        .map((ai) => `${ai.provider}/${ai.model}`);
      assert.ok(
        articleJobs.every(
          (job) => job.status === "completed" && allowedModels.includes(job.providerModel),
        ),
      );
      report.models = [...new Set(articleJobs.map((job) => job.providerModel))];
      assert.equal(flowIssue(final), null);
      assert.deepEqual(Object.keys(final.artifacts).sort(), [...STAGES].sort());
      assert.ok(STAGES.every((stage) => final.artifacts[stage].revision === final.revision));
      assert.equal(final.approval, null);
      assert.equal(final.satisfiedRevision, null);
      const download = editorial.download(started.id, final.revision);
      const expected = Buffer.from(toTxt(final.artifacts.draft.output.text), "utf8");
      assert.deepEqual(Buffer.from(download.text, "utf8"), expected);
      const articlePath = join(root, download.filename);
      await writeFile(articlePath, download.text, { mode: 0o600, flag: "wx" });
      assert.deepEqual(await readFile(articlePath), expected);
      // 선택: CONTRACT_FEEDBACK="<피드백>"로 수정 회차 1회까지 검증(담당 재사용 비용 비교용).
      if (process.env.CONTRACT_FEEDBACK) {
        await editorial.action(started.id, {
          operationId: `contract-feedback-${randomBytes(8).toString("hex")}`,
          type: "feedback",
          expectedVersion: view.version,
          feedback: process.env.CONTRACT_FEEDBACK,
        });
        const revisionDeadline = Date.now() + ARTICLE_DEADLINE_MS;
        let revised = editorial.get(started.id);
        while (revised.status !== "awaiting_user" || revised.revision === final.revision) {
          signal.throwIfAborted();
          assert.equal(revised.issue, null, "수정 회차에 확인이 필요합니다.");
          assert.notEqual(revised.status, "failed", "수정 회차가 실패했습니다.");
          assert.ok(Date.now() < revisionDeadline, "Revision timed out");
          await delay(500, undefined, { signal });
          revised = editorial.get(started.id);
        }
        report.feedbackRevision = revised.revision;
      }
      // 프롬프트 품질 근거: 코드 지표와 검토 판정(원문은 싣지 않음) · ADR-0013
      const outline = final.artifacts.outline.output;
      const review = final.artifacts.review.output;
      report.quality = {
        characters: readerLength(final.artifacts.draft.output.text),
        requirements: requirements(final),
        autoCorrections: final.autoCorrections ?? 0,
        callsByStage: Object.fromEntries(
          STAGES.map((stage) => [
            stage,
            articleJobs.filter((job) => job.action.stage === stage).length,
          ]),
        ),
        storyCards: outline.sections.filter((section) => section?.hook).length,
        cardSections: outline.sections.filter((section) => usesStoryCard(sectionMode(section)))
          .length,
        sections: outline.sections.length,
        metrics: draftMetrics(final.artifacts.draft.output.text, { outline }),
        verdict: review.verdict ?? null,
        failedChecks: (review.checks ?? []).filter((c) => !c.pass).map((c) => c.id),
        // 미통과 근거(검토가 적은 판정 이유) · 반복 평가에서 같은 지적이 되풀이되는지 본다
        failedNotes: Object.fromEntries(
          (review.checks ?? [])
            .filter((c) => !c.pass)
            .map((c) => [c.id, String(c.note ?? "").slice(0, 300)]),
        ),
        checks: review.checks?.length ?? 0,
      };
      const owned = await readJobs();
      report.workers = {
        reused: owned.filter((job) => job.reusedWorker).length,
        created: owned.filter((job) => !job.reusedWorker && !job.ai?.pilot).length,
      };
      Object.assign(report, {
        durationMs: Date.now() - articleStarted,
        stages: STAGES,
        revision: final.revision,
        status: final.status,
        articlePath,
      });
    }
    signal.throwIfAborted();
    report.result = "passed";
  } catch (error) {
    failure = error;
    report.failureCode = error.code ?? error.name;
  } finally {
    // 전달 중단 → HTTP 작업 종료 → 소유 AI 종료 확인 순서로 새 작업 생성을 차단한다.
    if (n8n) await clean("n8n_stop_unconfirmed", () => n8n.stop());
    if (server?.listening)
      await clean(
        "http_close_unconfirmed",
        () =>
          new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()));
            server.closeAllConnections();
          }),
      );
    if (editorial)
      await clean("worker_drain_unconfirmed", async () => {
        await Promise.all([...editorial.locks.values()]);
      });
    if (jobs)
      await clean("job_inventory_unconfirmed", async () => {
        for (const id of await ownedJobIds()) {
          await clean(`job_stop_unconfirmed:${id}`, async () => {
            const job = await jobs.read(id);
            if (!terminal(job))
              assert.ok(terminal(await jobs.stop(job.id)), "AI stop has not been confirmed");
          });
        }
      });
    // 담당 대기 세션까지 내려놓는다 · 끝난 검증 실행의 세션이 남아 제공자 프로세스를 잡지 않게 · ADR-0015
    if (jobs)
      await clean("session_release_unconfirmed", async () => {
        const { failed } = await jobs.sweepSessions({ all: true });
        assert.equal(failed, 0, "AI session release has not been confirmed");
      });
    if (store) await clean("store_close_unconfirmed", () => store.close());
    if (client) await clean("client_close_unconfirmed", () => client.close());
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
  }
  if (failure || cleanupIssues.length || signal.aborted) report.result = "failed";
  report.cleanupIssues = cleanupIssues;
  // 토큰 최적화 비교 기준: 제공자 보고값만 단계별로 기록.
  report.usage = usageSummary(await readJobs().catch(() => []));
  const reportPath = join(root, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  if (report.result !== "passed")
    throw Object.assign(
      new Error(
        `Live verification failed (${report.phase} · ${report.failureCode ?? "cleanup"}); report: ${reportPath}` +
          (cleanupIssues.length ? `; 종료 확인 필요: ${cleanupIssues.join(", ")}` : ""),
      ),
      { report },
    );
  if (!quiet) console.log(JSON.stringify(report));
  await scratch.release();
  return report;
}

export async function liveVerificationCli(options) {
  const args = process.argv.slice(2);
  const budget =
    options?.article === false
      ? "연결 확인 최대 1회 호출."
      : `최대 연결 확인 1회 + 글 ${ARTICLE_CALL_LIMIT}회 호출.`;
  if (args.length) {
    const help = args.length === 1 && ["--help", "-h"].includes(args[0]);
    console[help ? "log" : "error"](
      `추가 인자 없이 실행하세요. ${budget} ` +
        "--resume/--feedback 원시 상태 실행은 폐기되었습니다. 이어가기·피드백은 영속 글쓰기 UI에서 진행하세요.",
    );
    if (!help) process.exitCode = 1;
    return;
  }
  requireLiveConsent(budget);
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
