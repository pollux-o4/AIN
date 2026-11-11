import { randomUUID } from "node:crypto";
import { directionSchema } from "../contracts/writing-modes.mjs";
import { CliError } from "./client.mjs";

const PENDING = ["waiting_ai", "waiting_route"];
const ACTIONS = ["pause", "resume", "complete_requirements", "satisfy", "authorize_publication"];

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
    findings: run.findings,
    can: {
      feedback: run.canFeedback,
      pause: run.monitor?.canPause,
      resume: run.monitor?.canResume,
      completeRequirements: run.canCompleteRequirements,
      satisfy: run.canSatisfy,
      authorizePublication: run.canAuthorizePublication,
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
    if (!PENDING.includes(run.status) || run.issue) return summary(run, { text: true });
    if (Date.now() > deadline)
      throw new CliError(`대기 시간 초과: ${run.monitor?.label ?? run.status}`);
    await sleep(Number(interval) * 1000);
  }
}

export const commands = {
  list: (c) => c.list(),
  show: (c, [id], o) => c.get(need(id)).then((run) => summary(run, { text: Boolean(o.text) })),
  history: (c, [id]) => c.history(need(id)),
  new: async (c, _args, o, io) => {
    const idea = need(o.idea, "--idea");
    const direction = directionSchema.safeParse({ mode: o.mode, readerLevel: o.level });
    if (!direction.success)
      throw new CliError(
        "--mode: auto|explain|procedure|argue|narrate · --level: auto|beginner|intermediate|expert",
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
  ...Object.fromEntries(
    ACTIONS.map((type) => [type.replaceAll("_", "-"), (c, [id]) => act(c, need(id), type)]),
  ),
  wait: (c, [id], o, io) => wait(c, need(id), { ...o, sleep: io.sleep }),
  download: (c, [id], o) => c.download(need(id), o.revision),
  delete: (c, [id]) => c.archive(need(id)),
};

function need(value, name = "작업 ID") {
  if (value === undefined || value === "" || value === true)
    throw new CliError(`${name}가 필요합니다.`);
  return value;
}
