// shortcut: 시드·실행·관찰·렌더가 한 파일에 있음(실험 도구), 두 번째 파일럿 진입점이 생기면 시드·관찰을 lab 아래 모듈로 분리하고 결과를 writeLabRecord로 직접 남김
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { connectLocalPaseo } from "../../../../paseo/sdk.mjs";
import { AI_MODELS } from "../../contracts/ai-models.mjs";
import { FIGURE_LIMITS } from "../../contracts/figure.mjs";
import { RUNTIME_PROTOCOL } from "../../contracts/runtime.mjs";
import { flowIssue, STAGES, transition } from "../../editorial/domain/index.mjs";
import { EditorialStore } from "../../editorial/index.mjs";
import { usageSummary } from "../usage.mjs";
import { requireLiveConsent } from "./consent.mjs";

const execFileAsync = promisify(execFile);

const PLAN_DEADLINE_MS = 600_000;
const GENERATE_DEADLINE_MS = FIGURE_LIMITS.generateMs * 3;
const POLL_INTERVAL_MS = 1500;
const DEFAULT_CASE = ".local/figure-pilot/cases/algo-short.json";
const DEFAULT_OUT = ".local/figure-pilot/res010";
const DEFAULT_RUNTIME = ".local/ai-runtime";
const DEFAULT_URL = "http://127.0.0.1:3230";

function buildSatisfiedState(caseData, articleId) {
  let { state } = transition(null, {
    id: `pilot-start-${articleId}`,
    actor: "user",
    type: "start",
    articleId,
    idea: caseData.idea,
    source: caseData.source ?? "",
    ...(caseData.direction ? { direction: caseData.direction } : {}),
  });
  for (const stage of STAGES) {
    state = transition(state, {
      id: `pilot-complete-${stage}-${articleId}`,
      actor: "adapter",
      type: "complete",
      expectedVersion: state.version,
      revision: state.revision,
      stage,
      output: caseData.artifacts[stage],
    }).state;
  }
  state = transition(state, {
    id: `pilot-satisfy-${articleId}`,
    actor: "user",
    type: "satisfy",
    expectedVersion: state.version,
    reviewedRevision: state.revision,
  }).state;
  assert.equal(flowIssue(state), null, "Seeded state must pass flowIssue");
  assert.equal(state.status, "satisfied");
  return state;
}

function seedRun({ runtimeDir, caseData }) {
  const articleId = randomUUID();
  const state = buildSatisfiedState(caseData, articleId);
  const now = Date.now();
  const run = {
    id: articleId,
    requestId: `figure-pilot-${articleId}`,
    state,
    ai: { ...AI_MODELS.standard, enabled: true, maxDurationMs: 300_000 },
    callsUsed: 0,
    maxCalls: STAGES.length,
    startedAt: now,
    updatedAt: now,
    operations: {},
    issue: null,
    pending: null,
    queuedAt: now,
    worker: null,
    events: [{ at: now, kind: "satisfied", label: "초안 확정(시드)", revision: 1 }],
  };
  const store = new EditorialStore(join(runtimeDir, "editorial.sqlite"));
  try {
    store.save(run);
  } finally {
    store.close();
  }
  return articleId;
}

async function createHttpSession(baseUrl) {
  const origin = new URL(baseUrl).origin;
  const health = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(3000) });
  if (!health.ok) throw new Error(`편집 서버 상태 확인 실패 (${health.status})`);
  const info = await health.json();
  if (info.protocol !== RUNTIME_PROTOCOL)
    throw new Error(`편집 서버 프로토콜 불일치: ${info.protocol} !== ${RUNTIME_PROTOCOL}`);

  const session = await fetch(`${origin}/write/session`, { signal: AbortSignal.timeout(3000) });
  if (!session.ok) throw new Error(`글쓰기 세션 시작 실패 (${session.status})`);
  const cookie = session.headers.getSetCookie()[0]?.split(";")[0];
  if (!cookie) throw new Error("세션 쿠키를 받지 못했습니다.");

  async function request(path, { body, raw = false } = {}) {
    const response = await fetch(`${origin}/write/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        ...(body === undefined ? {} : { origin, "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(`${path} 실패 (${response.status}): ${err.error ?? "unknown"}`);
    }
    return raw ? response.text() : response.json();
  }

  return { request };
}

async function readArticleJobs(jobsDir, articleId) {
  let files;
  try {
    files = await readdir(jobsDir);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const matched = [];
  for (const file of files) {
    if (!/^[a-f0-9]{64}\.json$/.test(file)) continue;
    try {
      const job = JSON.parse(await readFile(join(jobsDir, file), "utf8"));
      if (job.state?.articleId === articleId) matched.push(job);
    } catch {
      // 저장 중인 임시 상태는 다음 주기에 읽는다
    }
  }
  return matched.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

async function capturePaseoToolsLog(agentId) {
  try {
    const { stdout } = await execFileAsync("paseo", ["logs", agentId, "--filter", "tools"], {
      timeout: 5000,
    });
    const text = stdout.trim();
    if (!text || text.includes("No activity to display.")) return null;
    return text;
  } catch {
    return null;
  }
}

async function captureProjectedTimeline(client, agentId) {
  try {
    const page = await client.agents
      .ref(agentId)
      .timeline.refetch({ direction: "tail", limit: 400, projection: "projected" });
    if (page.error || !Array.isArray(page.entries) || !page.entries.length) return null;
    return page.entries;
  } catch {
    return null;
  }
}

function summarizeTimelineTools(logText, timelineEntries, afterSeq = -1) {
  if (Array.isArray(timelineEntries) && timelineEntries.length) {
    const scoped =
      afterSeq >= 0
        ? timelineEntries.filter((entry) => entry.seqStart > afterSeq)
        : timelineEntries;
    const tools = scoped
      .filter((entry) => entry.item?.type === "tool_call")
      .map((entry) => entry.item);
    if (tools.length > 0) {
      let renders = 0;
      let views = 0;
      let editsAfterView = 0;
      let viewedYet = false;
      const items = [];
      for (const tool of tools) {
        const detail = typeof tool.detail === "object" && tool.detail ? tool.detail : {};
        const type = String(detail.type ?? tool.name ?? "unknown");
        const command = String(detail.command ?? detail.cmd ?? "");
        const target = String(detail.path ?? detail.filePath ?? detail.file ?? "");
        const summary = `${type}:${command || target}`.slice(0, 200);
        items.push(summary);
        if (
          type === "shell" &&
          /(?:\.png|screenshot|render|capture|rsvg|inkscape|chrome|playwright|resvg)/i.test(command)
        ) {
          renders += 1;
        }
        const isImageRead =
          (type === "read" || /read|view|open|image/i.test(type)) &&
          /\.png\b|\.webp\b|\.jpe?g\b/i.test(target);
        if (isImageRead) {
          views += 1;
          viewedYet = true;
        }
        const isSvgEdit =
          (type === "edit" || type === "write" || /edit|write/i.test(type)) &&
          /\.svg\b/i.test(target);
        if (viewedYet && isSvgEdit) {
          editsAfterView += 1;
        }
      }
      return {
        source: "projected",
        totalTools: tools.length,
        renders,
        views,
        editsAfterView,
        items,
      };
    }
  }
  if (typeof logText === "string" && logText.trim()) {
    const lines = logText.split("\n").filter((line) => line.trim());
    let renders = 0;
    let readsAfterRender = 0;
    let editsAfterRender = 0;
    let renderedYet = false;
    for (const line of lines) {
      if (
        /^\[Shell\]/i.test(line) &&
        /(?:\.png|screenshot|render|capture|rsvg|inkscape|chrome|playwright|resvg)/i.test(line)
      ) {
        renders += 1;
        renderedYet = true;
      } else if (renderedYet && /^\[Read file\]/i.test(line)) {
        readsAfterRender += 1;
      } else if (renderedYet && /^\[(?:Edit|Write) file\]/i.test(line)) {
        editsAfterRender += 1;
      }
    }
    return {
      source: "paseo_logs",
      totalTools: lines.length,
      renders,
      views: readsAfterRender,
      editsAfterView: editsAfterRender,
      items: lines,
    };
  }
  return { source: "none", totalTools: 0, renders: 0, views: 0, editsAfterView: 0, items: [] };
}

async function renderSvgToPng(svgPath, pngPath) {
  const svgAbs = resolve(svgPath);
  const pngAbs = resolve(pngPath);
  const htmlPath = `${svgAbs}.preview.html`;
  const svgBody = await readFile(svgAbs, "utf8");
  await writeFile(
    htmlPath,
    `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;display:flex;justify-content:center;align-items:flex-start">${svgBody}</body></html>`,
    { mode: 0o600 },
  );
  await execFileAsync(
    "/usr/bin/google-chrome",
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      `--screenshot=${pngAbs}`,
      "--window-size=1400,1000",
      pathToFileURL(htmlPath).href,
    ],
    { timeout: 15000 },
  );
  return pngAbs;
}

function createAgentObserver({ client, jobsDir, articleId, trial, outDir, signal }) {
  const tracked = new Map();
  let scanning = false;

  async function snapshotAgent(job) {
    const record = tracked.get(job.id);
    if (!record || record.frozen || record.snapshotting) {
      if (record && !record.frozen) record.dirty = true;
      return;
    }
    record.snapshotting = true;
    try {
      const pass = job.action?.pass ?? "unknown";
      const [logText, entries] = await Promise.all([
        capturePaseoToolsLog(job.agentId),
        captureProjectedTimeline(client, job.agentId),
      ]);
      if (logText) {
        record.logText = logText;
        const logPath = join(outDir, `logs-t${trial}-${pass}-${job.agentId}.txt`);
        record.logPath = logPath;
        await writeFile(logPath, `${logText}\n`, { mode: 0o600 });
      }
      if (entries) {
        record.canonicalEntries = entries;
        const jsonPath = join(outDir, `timeline-t${trial}-${pass}-${job.agentId}.json`);
        record.canonicalPath = jsonPath;
        await writeFile(jsonPath, JSON.stringify(entries, null, 2), { mode: 0o600 });
      }
    } finally {
      record.snapshotting = false;
      if (record.dirty && !record.frozen && !signal.aborted) {
        record.dirty = false;
        void snapshotAgent(job);
      }
    }
  }

  async function scan() {
    if (scanning || signal.aborted) return;
    scanning = true;
    try {
      const jobs = await readArticleJobs(jobsDir, articleId);
      for (const job of jobs) {
        if (job.action?.stage !== "figure" || !job.agentId) continue;
        let record = tracked.get(job.id);
        if (!record) {
          record = {
            jobId: job.id,
            agentId: job.agentId,
            pass: job.action.pass,
            figureId: job.action.figureId,
            afterSeq: job.workerBoundary?.seq ?? -1,
            logText: null,
            logPath: null,
            canonicalEntries: null,
            canonicalPath: null,
            snapshotting: false,
            dirty: false,
            frozen: false,
            unsubscribe: null,
          };
          tracked.set(job.id, record);
          const agent = client.agents.ref(job.agentId);
          if (agent.timeline) {
            record.unsubscribe = agent.timeline.subscribe(() => {
              if (!record.frozen && !signal.aborted) void snapshotAgent(job);
            });
          }
        }
        if (record.frozen) continue;
        record.afterSeq = job.workerBoundary?.seq ?? record.afterSeq;
        await snapshotAgent(job);
        if (["completed", "failed"].includes(job.status)) {
          record.frozen = true;
          record.unsubscribe?.();
          record.unsubscribe = null;
        }
      }
    } finally {
      scanning = false;
    }
  }

  function close() {
    for (const record of tracked.values()) record.unsubscribe?.();
  }

  return { scan, tracked, close };
}

function pickCandidate(candidates, { selectAnchor, selectRelation, selectClaim, fallbackAnchor }) {
  if (selectAnchor) {
    const byAnchor = candidates.find((c) => c.anchor.includes(selectAnchor));
    if (byAnchor) return byAnchor;
  }
  if (selectRelation) {
    const byRelation = candidates.find((c) => c.relation === selectRelation);
    if (byRelation) return byRelation;
  }
  if (selectClaim) {
    const byClaim = candidates.find((c) => c.claim.includes(selectClaim));
    if (byClaim) return byClaim;
  }
  if (fallbackAnchor) {
    const byFallback = candidates.find((c) => c.anchor.includes(fallbackAnchor));
    if (byFallback) return byFallback;
  }
  return null;
}

async function runTrial({
  trial,
  caseData,
  generate,
  resumeRunId,
  selectAnchor,
  selectRelation,
  selectClaim,
  http,
  client,
  runtimeDir,
  outDir,
  signal,
}) {
  const startedAt = Date.now();
  const jobsDir = join(runtimeDir, "jobs");
  const articleId = resumeRunId || seedRun({ runtimeDir, caseData });
  let view = await http.request(`runs/${articleId}`);
  if (!resumeRunId) {
    assert.equal(view.status, "satisfied");
    assert.equal(view.canRequestFigures, true);

    view = await http.request(`runs/${articleId}/actions`, {
      body: {
        operationId: `pilot-req-${articleId}`,
        expectedVersion: view.version,
        type: "request_figures",
      },
    });
  }

  const planDeadline = Date.now() + PLAN_DEADLINE_MS;
  while (view.status !== "awaiting_figure_choice") {
    signal.throwIfAborted();
    assert.equal(view.issue, null, `위치 제안 중단: ${view.issue}`);
    assert.notEqual(view.status, "failed", "위치 제안 실패");
    assert.ok(Date.now() < planDeadline, "위치 제안 시간 초과");
    await delay(POLL_INTERVAL_MS, undefined, { signal });
    view = await http.request(`runs/${articleId}`);
  }

  const jobsAfterPlan = await readArticleJobs(jobsDir, articleId);
  const planJob = jobsAfterPlan.find((job) => job.action?.stage === "figure_plan");
  const planDurationMs = planJob
    ? Math.max(0, (planJob.steps?.at(-1)?.at ?? Date.now()) - Date.parse(planJob.createdAt))
    : Date.now() - startedAt;

  const trialReport = {
    trial,
    articleId,
    plan: {
      jobId: planJob?.id ?? null,
      providerModel: planJob?.providerModel ?? null,
      durationMs: planDurationMs,
      usage: planJob?.usage ?? null,
      coverage: view.figure.coverage,
      candidates: view.figure.candidates.map((c) => ({
        id: c.id,
        anchor: c.anchor,
        anchor30: c.anchor.slice(0, 30),
        claim: c.claim,
        relation: c.relation,
        without: c.without,
        mapping: c.mapping,
        kind: c.kind,
        scene: c.scene,
      })),
    },
    generation: null,
  };

  if (!generate) return trialReport;

  const chosen = pickCandidate(view.figure.candidates, {
    selectAnchor,
    selectRelation,
    selectClaim,
    fallbackAnchor: caseData.targetAnchor,
  });
  assert.ok(
    chosen,
    `대상 후보(anchor=${selectAnchor || "-"}, relation=${selectRelation || "-"}, claim=${selectClaim || "-"})를 찾지 못했습니다.`,
  );

  view = await http.request(`runs/${articleId}/actions`, {
    body: {
      operationId: `pilot-sel-${articleId}`,
      expectedVersion: view.version,
      type: "select_figures",
      figures: [chosen.id],
    },
  });

  const observer = createAgentObserver({ client, jobsDir, articleId, trial, outDir, signal });
  const genDeadline = Date.now() + GENERATE_DEADLINE_MS;
  try {
    while (view.status !== "awaiting_figure_review") {
      signal.throwIfAborted();
      await observer.scan();
      assert.equal(view.issue, null, `시각자료 생성 중단: ${view.issue}`);
      assert.notEqual(view.status, "failed", "시각자료 생성 실패");
      assert.ok(Date.now() < genDeadline, "시각자료 생성 시간 초과");
      await delay(POLL_INTERVAL_MS, undefined, { signal });
      view = await http.request(`runs/${articleId}`);
    }
    await observer.scan();
  } finally {
    observer.close();
  }

  const svgBody = await http.request(`runs/${articleId}/figures/${chosen.id}`, { raw: true });
  const svgPath = join(outDir, `t${trial}-${chosen.id}.svg`);
  await writeFile(svgPath, svgBody, { mode: 0o600 });
  const pngPath = join(outDir, `t${trial}-${chosen.id}.png`);
  await renderSvgToPng(svgPath, pngPath);

  const allJobs = await readArticleJobs(jobsDir, articleId);
  const figureJobs = allJobs.filter((job) => job.action?.stage === "figure");
  const passes = figureJobs.map((job) => {
    const obs = observer.tracked.get(job.id);
    const afterSeq = obs?.afterSeq ?? job.workerBoundary?.seq ?? -1;
    const tools = summarizeTimelineTools(
      obs?.logText ?? null,
      obs?.canonicalEntries ?? null,
      afterSeq,
    );
    return {
      pass: job.action?.pass ?? null,
      jobId: job.id,
      agentId: job.agentId,
      providerModel: job.providerModel,
      reusedWorker: Boolean(job.reusedWorker),
      durationMs: Math.max(0, (job.steps?.at(-1)?.at ?? Date.now()) - Date.parse(job.createdAt)),
      usage: job.usage ?? null,
      stepsCount: job.steps?.length ?? 0,
      logPath: obs?.logPath ?? null,
      canonicalPath: obs?.canonicalPath ?? null,
      visualCheck: tools,
    };
  });

  trialReport.generation = {
    selectedCandidateId: chosen.id,
    selectedAnchor: chosen.anchor,
    svgPath: resolve(svgPath),
    pngPath: resolve(pngPath),
    svgBytes: Buffer.byteLength(svgBody, "utf8"),
    item: view.figure.items[0] ?? null,
    passes,
    usage: usageSummary(figureJobs),
  };
  return trialReport;
}

async function main() {
  const { values } = parseArgs({
    options: {
      case: { type: "string", default: DEFAULT_CASE },
      trials: { type: "string", default: "2" },
      "generate-trials": { type: "string", default: "1" },
      "resume-run": { type: "string", default: "" },
      "select-anchor": { type: "string", default: "" },
      "select-relation": { type: "string", default: "" },
      "select-claim": { type: "string", default: "" },
      url: { type: "string", default: DEFAULT_URL },
      runtime: { type: "string", default: DEFAULT_RUNTIME },
      out: { type: "string", default: DEFAULT_OUT },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(
      "사용법: node automation/paseo/live/figure-pilot.mjs [--case path] [--trials 2] [--generate-trials 1] [--resume-run id] [--select-anchor text] [--select-relation rel] [--select-claim text] [--url http://127.0.0.1:3230] [--runtime .local/ai-runtime] [--out .local/figure-pilot/res010]",
    );
    return;
  }

  const trials = Number(values.trials);
  const generateTrials = Number(values["generate-trials"]);
  if (!Number.isInteger(trials) || trials < 1) throw new Error("--trials는 양의 정수여야 합니다.");
  if (!Number.isInteger(generateTrials) || generateTrials < 0 || generateTrials > trials)
    throw new Error("--generate-trials는 0 이상 --trials 이하여야 합니다.");

  requireLiveConsent(`시각자료 위치 제안 ${trials}회 + 그림 생성 ${generateTrials}회(층당 3회)`);

  const outDir = resolve(values.out);
  const runtimeDir = resolve(values.runtime);
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const caseData = JSON.parse(await readFile(resolve(values.case), "utf8"));

  const controller = new AbortController();
  const { signal } = controller;
  const onSignal = (name) => {
    process.exitCode = name === "SIGINT" ? 130 : 143;
    controller.abort(new Error(`Pilot interrupted (${name})`));
  };
  const onInt = () => onSignal("SIGINT");
  const onTerm = () => onSignal("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);

  const http = await createHttpSession(values.url);
  const client = await connectLocalPaseo();
  const results = [];
  try {
    for (let i = 1; i <= trials; i++) {
      console.error(`[pilot] trial ${i}/${trials} starting...`);
      const report = await runTrial({
        trial: i,
        caseData,
        generate: i <= generateTrials,
        resumeRunId: i === 1 ? values["resume-run"] : "",
        selectAnchor: values["select-anchor"],
        selectRelation: values["select-relation"],
        selectClaim: values["select-claim"],
        http,
        client,
        runtimeDir,
        outDir,
        signal,
      });
      results.push(report);
      console.error(
        `[pilot] trial ${i}/${trials} done: candidates=${report.plan.candidates.length}` +
          (report.generation ? `, svg=${report.generation.svgPath}` : ""),
      );
    }
  } finally {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    await client.close();
  }

  const summary = {
    caseId: caseData.id,
    trials,
    generateTrials,
    results,
  };
  const reportPath = join(outDir, "report.json");
  await writeFile(reportPath, JSON.stringify(summary, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ reportPath, trials: results.length }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
