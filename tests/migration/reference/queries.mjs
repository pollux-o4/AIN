// MIG-003 · 고정 시각과 저장값으로 상세·목록·이력 응답을 수집한다.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const fromRoot = (path) => import(pathToFileURL(resolve(root, path)));
const { transition, flowIssue } = await fromRoot("automation/editorial/domain/index.mjs");
const { EditorialService } = await fromRoot("automation/editorial/service.mjs");
const { editorialHttp } = await fromRoot("automation/editorial/http.mjs");
const { Jobs } = await fromRoot("automation/paseo/jobs.mjs");
const original = JSON.parse(readFileSync(new URL("./flow-001.json", import.meta.url)));
const now = 1_780_000_000_000;
const clock = () => now;
const model = { provider: "antigravity", model: "gemini-4-hydrogen", thinking: "medium" };

const setup = (name, extra = {}) => {
  const digest = createHash("sha256").update(name).digest("hex");
  const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
  return {
    updatedAt: now - 2000, startedAt: now - 7000, queuedAt: now - 10000,
    callsUsed: 0, maxCalls: 8, ai: model, ...extra,
    id, requestId: `req-${name}`, state: { ...(extra.state ?? structuredClone(original[0].state)), articleId: id },
  };
};
const first = structuredClone(original.at(-1).state);
first.artifacts.draft.output = { text: "# 실제 초안 제목\n\n이전 회차 본문입니다.", changeSummary: "첫 회차 요약" };
first.artifacts.research.output.uncertainties = ["출처 다시 확인"];
first.artifacts.review.output.findings = ["출처 다시 확인", "검토에서만 확인"];
const revised = structuredClone(first);
revised.revision = 2;
revised.version += 3;
revised.history = [{
  revision: 1, artifacts: first.artifacts, stage: "review", status: "awaiting_user",
  feedback: "구성을 간결하게", reviewed: true,
}];
for (const artifact of Object.values(revised.artifacts)) artifact.revision = 2;
revised.artifacts.diagnose.reusedFromRevision = 1;
revised.artifacts.audience.output = { reader: "입문 독자", intent: "절차를 따라 하기" };
revised.artifacts.outline.output = {
  sections: [
    { title: "설정 확인", mode: "procedure", keyPoint: "기준을 찾는다" },
    { title: "현상 분리", mode: "procedure", keyPoint: "조건을 하나씩 대조한다" },
  ],
  rationale: "점검한 순서를 유지",
};
revised.artifacts.draft.output = {
  text: "# 수정한 실제 제목\n\n새 회차 본문입니다.", changeSummary: "순서를 짧게 정리",
  edits: [{ find: "이전 회차", replace: "새 회차" }],
};
revised.requirementLog = [{
  revision: 2, source: "feedback", changes: [
    { kind: "mode", op: "set", value: "procedure", quote: "따라 하게" },
    { kind: "readerLevel", op: "set", value: "beginner", quote: "처음 보는 독자" },
    { kind: "tone", op: "set", value: "차분하게", quote: "차분한 문장으로" },
  ],
}];
revised.brief = {
  intent: "간결하게 정리", target: "draft", level: "line", priorities: ["첫 문단 정리"], preserve: ["원문"],
  requirementChanges: [{ kind: "length", op: "lift", quote: "분량 제한 없음" }],
};
const jobKey = (label) => createHash("sha256").update(label).digest("hex");
const priorEvent = (at, kind, revision, stage, details = {}) => ({
  at: now + at, kind, label: kind, revision, stage, executionId: null, ...details,
  ...(details.jobId ? { jobId: jobKey(details.jobId) } : {}),
});
const richEvents = [
  priorEvent(-62000, "ai_requested", 1, "topic", { jobId: "prior-job", executionId: "legacy/42" }),
  priorEvent(-61000, "ai_completed", 1, "topic", { jobId: "prior-job", executionId: "legacy/42" }),
  priorEvent(-59000, "ai_requested", 1, "topic", { jobId: "missing-prior" }),
  priorEvent(-57000, "ai_completed", 1, "topic", { jobId: "missing-prior" }),
  priorEvent(-52000, "feedback", 2, "route", { reason: "순서를 간결하게" }),
  priorEvent(-50000, "ai_requested", 2, "route", { jobId: "route-job" }),
  priorEvent(-49000, "ai_completed", 2, "route", { jobId: "route-job" }),
  priorEvent(-43000, "ai_requested", 2, "draft", { jobId: "failed-job" }),
  priorEvent(-40000, "failed", 2, "draft", { reason: "다시 실행 필요" }),
  priorEvent(-9000, "ai_requested", 2, "draft", { jobId: "missing-current" }),
  priorEvent(-5000, "ai_completed", 2, "draft", { jobId: "missing-current" }),
  priorEvent(-4000, "ready", 2, "review"),
];
const rawJobs = {
  "prior-job": {
    providerModel: "fixture/model",
    state: { source: "이전 참고 자료", artifacts: { diagnose: first.artifacts.diagnose }, history: [] },
    action: { type: "request_ai", stage: "topic" },
    inputSummary: { source: true, feedback: false, stages: ["diagnose"], baseline: false },
    event: { output: { problem: "실행 시점 문제", scope: "기록 범위", internal: "SYNTHETIC_PRIVATE_MARKER" } },
    status: "completed", usage: { inputTokens: 91, outputTokens: 9 },
    steps: [{ kind: "note", text: "합성 근거를 읽었습니다.", at: now - 61800 }],
  },
  "route-job": {
    providerModel: "fixture/model", status: "completed",
    state: { source: "", feedback: "순서 조정", artifacts: { review: first.artifacts.review }, history: [] },
    action: { type: "request_route" }, event: { target: "draft", reason: "문장 수정" },
    usage: { inputTokens: 10, outputTokens: 2 },
  },
  "failed-job": {
    providerModel: "fixture/model", status: "failed", failureKind: "invalid_output",
    state: { source: "", artifacts: {}, history: [] },
    action: { type: "request_ai", stage: "draft", section: { index: 0, total: 2 } },
    inputSummary: { source: false, feedback: false, stages: [], baseline: false },
    usage: { inputTokens: 20, outputTokens: 3 }, diagnostic: "SYNTHETIC_PRIVATE_MARKER",
    steps: [{ kind: "tool", text: "자료 읽기", status: "failed", at: now - 42900 }],
  },
};
const jobs = Object.fromEntries(Object.entries(rawJobs).map(([name, job]) => {
  const id = jobKey(name);
  return [id, { id, ...job }];
}));
const presented = setup("presented", {
  state: { ...revised, articleId: "presented" }, events: richEvents, callsUsed: 3,
  operations: { "z-first": "original-signature", "a-second": "another-signature" },
});
const approved = transition(presented.state, {
  id: "satisfied", actor: "user", type: "satisfy", reviewedRevision: 2,
  expectedVersion: presented.state.version,
}).state;
const proposing = transition(approved, {
  id: "propose", actor: "user", type: "request_figures", reviewedRevision: 2,
  expectedVersion: approved.version, note: "새 회차에 그림 하나",
}).state;
const choosing = transition(proposing, {
  id: "pose", actor: "adapter", type: "figure_result", revision: 2,
  stage: "figure_plan", expectedVersion: proposing.version,
  output: { candidates: [{ anchor: "새 회차 본문입니다.", claim: "새 회차 핵심", reason: "첫 설명" }] },
}).state;
const cases = [
  ["queued", setup("queued")],
  ["working", setup("working", {
    pending: { jobId: "live-job" }, worker: { confirmedAt: now - 500, executionId: "running-43" },
    callsUsed: 1, events: [priorEvent(-1600, "ai_requested", 1, "diagnose", { jobId: "live-job" })],
  })],
  ["stale", setup("stale", {
    pending: { jobId: "stale-job" }, worker: { confirmedAt: now - 28000 },
    events: [priorEvent(-30000, "ai_requested", 1, "diagnose", { jobId: "stale-job" })],
  })],
  ["presented", presented],
  ["figure choice", setup("figure-choice", { state: { ...choosing, articleId: "figure-choice" }, updatedAt: now - 900 })],
  ["astral title", setup("astral-title", { state: { ...structuredClone(original[0].state), articleId: "astral-title", idea: "🧪".repeat(102) } })],
  ["archived satisfied", setup("archived", {
    state: { ...approved, articleId: "archived" }, archivedAt: now - 500, updatedAt: now - 500,
  })],
  ["incomplete with retained draft", setup("incomplete", {
    state: {
      ...revised, articleId: "incomplete", revision: 3, version: revised.version + 1, status: "waiting_ai",
      stage: "draft", artifacts: {}, history: [...revised.history, { revision: 2, artifacts: revised.artifacts }],
    },
    updatedAt: now - 600,
  })],
];
for (const [name, run] of cases) {
  if (Boolean(flowIssue(run.state)) !== (name === "incomplete with retained draft"))
    throw new Error(`Unexpected flow issue for synthetic case ${name}`);
}
const records = cases.map(([, run]) => run);
const byID = new Map(records.map((run) => [run.id, run]));
const store = {
  get: (id) => structuredClone(byID.get(id)),
  stamps: () => records.map(({id, updatedAt, archivedAt, state}) =>
    ({id, updatedAt, archivedAt, status: state.status})),
};
const temp = mkdtempSync(join(tmpdir(), "ain-query-reference-"));
try {
  const jobsRoot = join(temp, "jobs");
  mkdirSync(jobsRoot, { mode: 0o700 });
  for (const job of Object.values(jobs))
    writeFileSync(join(jobsRoot, `${job.id}.json`), JSON.stringify(job), { mode: 0o600 });
  const service = new EditorialService({
    store, now: clock,
    jobs: new Jobs({ client: null, root: jobsRoot, workRoot: join(temp, "workspaces") }),
    dispatch: () => { throw Error("reference query tried to dispatch writing"); },
  });
  const agentToken = "synthetic-agent-authorization".repeat(2);
  const handler = editorialHttp({ service, token: "synthetic-editorial-session-secret", agentToken });
  const get = async (url) => {
    let status, body;
    await handler({ method: "GET", url, headers: { host: "localhost", authorization: `Bearer ${agentToken}` } }, {
      writeHead(code) { status = code; },
      end(data) { body = data; },
    });
    if (status !== 200) throw Error(`Reference GET ${url} returned ${status}`);
    return JSON.parse(body);
  };
  const fixtures = [];
  for (const [name, run] of cases) {
    const path = `/write/api/runs/${run.id}`;
    fixtures.push({ name, record: run, detail: await get(path), history: await get(`${path}/history`) });
  }
  process.stdout.write(JSON.stringify({ now, jobs, cases: fixtures, list: await get("/write/api/runs") }, null, 2) + "\n");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
