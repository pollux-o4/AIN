import { randomUUID } from "node:crypto";
import { buildPrompt } from "./prompts/index.mjs";
import { deltaContext, sessionEndsAfter } from "./roles.mjs";

async function workerTimeline(agent, limit) {
  const page = await agent.timeline.refetch({ direction: "tail", projection: "canonical", limit });
  if (page.error || !page.epoch || !page.window) throw new Error("Worker timeline unavailable");
  return page;
}

// 담당 재사용: 같은 담당이 이전 지적·결정을 기억해 이어 맡음 · 제공자 측 캐시로 재전송 비용보다 유리하다고 판단(2026-11-14 사용자 결정)
// 2026-11-10 실측(cachedInputTokens 0, 입력 +13%)은 캐시 집계 오탐으로 폐기
// 같은 담당 안에서 모델(effort)이 바뀌어도 세션은 유지하고 모델만 교체
export const REUSE_PROVIDERS = Object.freeze(["antigravity"]);

const splitProviderModel = (providerModel) => {
  const index = providerModel.indexOf("/");
  return [providerModel.slice(0, index), providerModel.slice(index + 1)];
};

// 다음 턴 응답만 인정하기 위한 경계 · 전송 직전 canonical 마지막 seq·turn·usage
async function turnBoundary(agent) {
  const page = await workerTimeline(agent, 1);
  if (page.agent?.status !== "idle" || page.agent.archivedAt)
    throw new Error("Worker became unavailable");
  return {
    epoch: page.epoch,
    seq: page.window.maxSeq,
    turnId: page.entries.at(-1)?.turnId ?? null,
    usage: agent.lastUsage ?? null,
  };
}

export class RoleSessions {
  #client;
  #workers;
  #save;
  #reuseProviders;

  constructor({ client, workers, save, reuseProviders = REUSE_PROVIDERS }) {
    this.#reuseProviders = new Set(reuseProviders);
    this.#client = client;
    this.#workers = workers;
    this.#save = save;
  }

  #reusable(job) {
    return Boolean(job.role) && this.#reuseProviders.has(job.ai?.provider);
  }

  async acquire(job, context) {
    if (!this.#reusable(job)) return { reused: false };
    const worker = await this.#workers.get(job.state.articleId, job.role);
    if (!worker) return { reused: false };
    let agent;
    let boundary;
    try {
      agent = this.#client.agents.ref(worker.agentId);
      await agent.refresh();
      if (agent.status !== "idle" || agent.archivedAt) throw new Error("Worker is unavailable");
      // 세션의 실제 제공자·모델은 Paseo가 원천 · 같은 제공자면 대화 기억을 유지한 채 모델만 교체
      const [provider, model] = splitProviderModel(job.providerModel);
      const current = agent.current();
      if (current?.provider !== provider) throw new Error("Worker provider changed");
      if (current.model !== model) await this.#client.setAgentModel(worker.agentId, model);
      boundary = await turnBoundary(agent);
    } catch {
      await this.#workers.drop(job.state.articleId, job.role, worker.agentId);
      return { reused: false };
    }
    const delta = deltaContext(context, worker.delivered);
    await this.#workers.drop(job.state.articleId, job.role, worker.agentId);
    job.agentId = worker.agentId;
    job.reusedWorker = true;
    job.workerBoundary = boundary;
    await this.#save(job);
    try {
      await agent.send(buildPrompt(job.state, job.action, job.ai, delta));
    } catch {
      job.agentId = randomUUID();
      delete job.reusedWorker;
      delete job.workerBoundary;
      await this.#save(job);
      return { reused: false };
    }
    await this.#workers.put(job.state.articleId, job.role, {
      ...worker,
      delivered: delta.delivered,
    });
    return { reused: true };
  }

  // 같은 세션에 후속 턴을 보낸다(형식 오류 재요청 등) · 이후 판정은 경계 뒤 응답만 인정
  async followUp(job, agent, text) {
    job.workerBoundary = await turnBoundary(agent);
    await this.#save(job);
    await agent.send(text);
  }

  async register(job, agentId, context) {
    if (this.#reusable(job))
      await this.#workers.put(job.state.articleId, job.role, {
        agentId,
        delivered: deltaContext(context).delivered,
      });
  }

  async drop(job) {
    if (job.role && job.agentId)
      await this.#workers.drop(job.state.articleId, job.role, job.agentId);
  }

  // 재사용 대기 담당 외의 끝난 세션은 보관해 agy 프로세스(세션당 약 250MiB)를 종료한다.
  // 이어 맡을 작업이 없는 담당(마친 그림의 세션)은 대기시키지 않고 바로 내려놓는다 · ADR-0017
  async release(job, agent) {
    const keep = this.#reusable(job) && !job.providerRetried && !sessionEndsAfter(job.action);
    if (job.status === "completed" && keep) return;
    if (job.status === "completed" && this.#reusable(job)) await this.drop(job);
    try {
      await agent.archive();
    } catch {
      job.cleanupUnconfirmed = true;
    }
  }

  async verifyTurn(job, agent, result) {
    if (!job.workerBoundary || result.status !== "idle") return result;
    const page = await workerTimeline(agent, 100);
    const boundary = job.workerBoundary;
    if (page.epoch !== boundary.epoch) throw new Error("Worker timeline replaced");
    // SDK 0.13.1 waitForFinish는 이전 idle 응답도 반환하고 activeTurn은 완료 시 비워지므로 전송 전 canonical seq 이후 응답만 인정한다.
    const message = page.entries.findLast(
      (entry) =>
        entry.item.type === "assistant_message" &&
        entry.seqStart > boundary.seq &&
        (!boundary.turnId || entry.turnId !== boundary.turnId),
    );
    return message && page.agent?.status === "idle"
      ? await agent.waitForFinish(1000)
      : { status: "timeout" };
  }

  turnUsage(job, agent, result) {
    // Antigravity 0.13.1 session.prompt는 usage를 0으로 시작해 해당 턴의 step만 합산한다.
    const usage = result.final?.lastUsage ?? agent.lastUsage ?? null;
    // shortcut: SDK usage에 턴 ID가 없어 동일 값의 잔존·다른 제공자의 집계 범위는 미보고 처리, 제공자별 턴 usage 식별 지원 시 재검토
    return job.workerBoundary &&
      (job.ai.provider !== "antigravity" ||
        JSON.stringify(usage) === JSON.stringify(job.workerBoundary.usage))
      ? null
      : usage;
  }
}
