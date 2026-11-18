import { randomUUID } from "node:crypto";
import { isPendingStatus } from "../contracts/status.mjs";
import { directionSchema, lengthRange } from "../contracts/writing-modes.mjs";
import { CliError } from "./client.mjs";
import { renderUsage } from "./usage-view.mjs";

// 최종 검수(satisfy·authorize_publication)는 사람만 · 화면에서 · ADR-0006
const ACTIONS = ["pause", "resume", "complete_requirements"];

// 에이전트가 판단에 쓰는 요약 · 본문은 --text일 때만
function summary(run, { text = false } = {}) {
  return {
    id: run.id,
    title: run.title,
    status: run.status,
    label: run.monitor?.label,
    revision: run.revision,
    textRevision: run.textRevision,
    issue: run.issue ?? null,
    needsCompletion: run.needsCompletion,
    completionReason: run.completionReason,
    brief: run.brief ?? null,
    // 지금 유효한 요구(요구 장부) · ADR-0016
    requirements: run.requirements ?? [],
    unmetRequirements: run.unmetRequirements ?? [],
    // 시각자료 선택·확인은 사람만 · 화면에서 · FIGURE-001
    figure: run.figure ?? null,
    findings: run.findings,
    can: {
      feedback: run.canFeedback,
      pause: run.monitor?.canPause,
      resume: run.monitor?.canResume,
      completeRequirements: run.canCompleteRequirements,
      humanSatisfy: run.canSatisfy,
      humanAuthorizePublication: run.canAuthorizePublication,
      // 수정 해석 승인·재해석 · 편집장 대리 가능 · ADR-0010
      approveBrief: run.canApproveBrief,
      download: run.canDownload,
    },
    ...(text ? { text: run.text } : {}),
  };
}

async function act(client, id, type, extra = {}) {
  const run = await client.get(id);
  const result = await client.action(id, {
    operationId: randomUUID(),
    expectedVersion: run.version,
    type,
    ...extra,
  });
  return summary(result);
}

async function wait(client, id, { timeout = 1800, interval = 3, sleep }) {
  const deadline = Date.now() + Number(timeout) * 1000;
  for (;;) {
    const run = await client.get(id);
    if (!isPendingStatus(run.status) || run.issue) return summary(run, { text: true });
    if (Date.now() > deadline)
      throw new CliError(`대기 시간 초과: ${run.monitor?.label ?? run.status}`);
    await sleep(Number(interval) * 1000);
  }
}

// --length 4500 → ±10% · 4000-5000 → 범위 · 공백 포함 문자 수
function lengthOption(value) {
  const [a, b] = String(value).split("-").map(Number);
  return b ? { min: a, max: b } : lengthRange(a);
}

export const commands = {
  list: (c) => c.list(),
  show: (c, [id], o) => c.get(need(id)).then((run) => summary(run, { text: Boolean(o.text) })),
  history: (c, [id]) => c.history(need(id)),
  usage: (c, [id], o) =>
    c.history(need(id)).then(({ usage }) => (o.json ? usage : renderUsage(usage))),
  new: async (c, _args, o, io) => {
    const idea = need(o.idea, "--idea");
    const direction = directionSchema.safeParse({
      mode: o.mode,
      readerLevel: o.level,
      targetLength: o.length ? lengthOption(o.length) : undefined,
    });
    if (!direction.success)
      throw new CliError(
        "--mode: auto|explain|procedure|argue|narrate · --level: auto|beginner|intermediate|expert · --length: 4500 또는 4000-5000",
      );
    const source = o["source-file"]
      ? await io.readFile(o["source-file"], "utf8")
      : (o.source ?? "");
    const run = await c.create({
      requestId: randomUUID(),
      idea,
      source,
      direction: direction.data,
    });
    return summary(run);
  },
  feedback: (c, [id, ...words], _o) =>
    act(c, need(id), "feedback", { feedback: need(words.join(" "), "수정 내용") }),
  "approve-brief": (c, [id]) => act(c, need(id), "approve_brief"),
  "revise-brief": (c, [id, ...words]) =>
    act(c, need(id), "revise_brief", { feedback: need(words.join(" "), "보정 의견") }),
  ...Object.fromEntries(
    ACTIONS.map((type) => [type.replaceAll("_", "-"), (c, [id]) => act(c, need(id), type)]),
  ),
  wait: (c, [id], o, io) => wait(c, need(id), { ...o, sleep: io.sleep }),
  download: (c, [id], o) => c.download(need(id), o.revision),
  // 묶음·문서는 파일로 저장(바이너리 zip을 표준 출력에 섞지 않음) · 결과는 저장 경로 JSON
  export: async (c, [id], o, io) => {
    const out = need(o.out, "저장 경로(--out)");
    const body = await c.export(need(id), o);
    await io.writeFile(out, body);
    return { saved: out, bytes: body.length, format: o.format ?? "txt" };
  },
  delete: (c, [id]) => c.archive(need(id)),
};

function need(value, name = "작업 ID") {
  if (value === undefined || value === "" || value === true)
    throw new CliError(`${name}가 필요합니다.`);
  return value;
}
