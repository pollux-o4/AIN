import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { connectLocalPaseo } from "../../../paseo/sdk.mjs";
import { toTxt } from "../contracts/txt.mjs";
import { directionSchema } from "../contracts/writing-modes.mjs";
import { flowIssue, STAGES, transition } from "../editorial/domain/index.mjs";
import { EditorialService, EditorialStore } from "../editorial/index.mjs";
import { startIsolatedN8n } from "../n8n/testing/runtime.mjs";
import { makeServer } from "../runtime/server.mjs";
import { Jobs } from "./index.mjs";
import { usageSummary } from "./usage.mjs";

const AI = {
  provider: "antigravity",
  model: "gemini-3.8-flash-medium",
  enabled: true,
  maxDurationMs: 120000,
};
const terminal = (job) => ["completed", "failed"].includes(job.status);

// 실제 비용 호출은 명시적 실행 때만: 연결 확인 1회 성공 후 합성 글 8회, 재시도·대체 없음.
export async function runLiveVerification({ article = true } = {}) {
  assert.equal(typeof article, "boolean");
  assert.equal(STAGES.length, 8);
  await mkdir(resolve(".local"), { recursive: true, mode: 0o700 });
  const root = await mkdtemp(resolve(".local/contract-live-"));
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
    report.phase = "pilot";
    const marker = `contract-pilot-${randomBytes(12).toString("hex")}`;
    const state = transition(null, {
      id: marker,
      articleId: marker,
      actor: "user",
      type: "start",
      idea: "짧은 연결 확인",
    }).state;
    const pilot = await jobs.create({ state, ai: { ...AI, pilot: true, maxDurationMs: 45000 } });
    const pilotDeadline = Date.now() + 60000;
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
    signal.throwIfAborted();
    if (article) {
      report.phase = "article";
      // 수정 회차 검증 시 경로 판단 1회 + 재생성 단계 최대 8회를 더 허용한다.
      limit = STAGES.length + 1 + (process.env.CONTRACT_FEEDBACK ? STAGES.length + 1 : 0);
      const token = randomBytes(32).toString("hex");
      const n8nUrl = "http://127.0.0.1:5738";
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
        port: 5738,
        bridgeUrl: `http://127.0.0.1:${server.address().port}`,
        token,
      });
      signal.throwIfAborted();
      // 선택: CONTRACT_DIRECTION="mode:readerLevel"로 사용자 지정 경로 검증. 없으면 자동 경로.
      const [mode, readerLevel] = (process.env.CONTRACT_DIRECTION ?? "").split(":");
      const direction = process.env.CONTRACT_DIRECTION
        ? directionSchema.parse({ mode, readerLevel })
        : undefined;
      const started = await editorial.create({
        ...(direction ? { direction } : {}),
        requestId: `contract-${randomBytes(12).toString("hex")}`,
        idea: "합성 검증용 한국어 수필 600~900자. 처음 요리를 해 보는 사람이 장보기 목록을 만들어 실수를 줄인 가상의 하루를 1인칭으로 써 주세요. 독자는 요리 초보자. 가상의 사례라는 점과 사람마다 준비가 다르다는 한계를 유지하고 실제 조사·의학·영양 조언·통계·출처는 만들지 마세요.",
        source:
          "합성 사례: 나는 주말에 처음 국을 만들려고 장보기 목록을 작성했다. 목록을 보고 재료를 준비하니 빠뜨린 것을 다시 사러 갈 일이 줄었다. 실제 인물·연구·통계가 아니다.",
      });
      const deadline = Date.now() + 660000;
      let view = editorial.get(started.id);
      while (view.status !== "awaiting_user") {
        signal.throwIfAborted();
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
      assert.equal(run.callsUsed, STAGES.length);
      assert.equal(articleJobs.length, STAGES.length);
      assert.deepEqual(articleJobs.map((job) => job.action.stage).sort(), [...STAGES].sort());
      assert.ok(
        articleJobs.every(
          (job) => job.status === "completed" && job.providerModel === report.model,
        ),
      );
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
        const revisionDeadline = Date.now() + 660000;
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
      const owned = await readJobs();
      report.workers = {
        reused: owned.filter((job) => job.reusedWorker).length,
        created: owned.filter((job) => !job.reusedWorker && !job.ai?.pilot).length,
      };
      Object.assign(report, {
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
    throw new Error(
      `Live verification failed (${report.phase}); report: ${reportPath}` +
        (cleanupIssues.length ? `; 종료 확인 필요: ${cleanupIssues.join(", ")}` : ""),
    );
  console.log(JSON.stringify(report));
  return report;
}

export async function liveVerificationCli(options) {
  const args = process.argv.slice(2);
  if (args.length) {
    const help = args.length === 1 && ["--help", "-h"].includes(args[0]);
    const budget =
      options?.article === false ? "연결 확인 최대 1회 호출." : "최대 연결 확인 1회 + 글 8회 호출.";
    console[help ? "log" : "error"](
      `추가 인자 없이 실행하세요. ${budget} ` +
        "--resume/--feedback 원시 상태 실행은 폐기되었습니다. 이어가기·피드백은 영속 글쓰기 UI에서 진행하세요.",
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
