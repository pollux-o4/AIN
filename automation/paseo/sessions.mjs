import { randomUUID } from "node:crypto";
import { buildPrompt } from "./prompts.mjs";
import { deltaContext } from "./roles.mjs";
import { Workers } from "./workers.mjs";

async function workerTimeline(agent, limit) {
  const page = await agent.timeline.refetch({ direction: "tail", projection: "canonical", limit });
  if (page.error || !page.epoch || !page.window) throw new Error("Worker timeline unavailable");
  return page;
}

// 담당 재사용은 누적 대화가 캐시될 때만 이득. 실측(2026-11-10, antigravity gemini-3.8-flash-medium):
// cachedInputTokens 0 · 8단계 입력 90,197 → 101,935(+13%)로 손해라 기본 비활성.
// shortcut: 캐시 적중이 실측으로 확인된 제공자만 추가, 제공자·모델 교체 시 report.usage로 재측정
export const REUSE_PROVIDERS = Object.freeze([]);

export class RoleSessions {
  #client;
  #workers;
  #save;
  #reuseProviders;

  constructor({ client, root, save, reuseProviders = REUSE_PROVIDERS }) {
    this.#reuseProviders = new Set(reuseProviders);
    this.#client = client;
    this.#workers = new Workers(root);
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
      if (worker.providerModel !== job.providerModel) throw new Error("Worker model changed");
      agent = this.#client.agents.ref(worker.agentId);
      await agent.refresh();
      if (agent.status !== "idle" || agent.archivedAt) throw new Error("Worker is unavailable");
      const page = await workerTimeline(agent, 1);
      if (page.agent?.status !== "idle" || page.agent.archivedAt)
        throw new Error("Worker became unavailable");
      boundary = {
        epoch: page.epoch,
        seq: page.window.maxSeq,
        turnId: page.entries.at(-1)?.turnId ?? null,
        usage: agent.lastUsage ?? null,
      };
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

  async register(job, agentId, context) {
    if (this.#reusable(job))
      await this.#workers.put(job.state.articleId, job.role, {
        agentId,
        providerModel: job.providerModel,
        delivered: deltaContext(context).delivered,
      });
  }

  async drop(job) {
    if (job.role && job.agentId)
      await this.#workers.drop(job.state.articleId, job.role, job.agentId);
  }

  // 재사용 대기 담당 외의 끝난 세션은 보관해 agy 프로세스(세션당 약 250MiB)를 종료한다.
  async release(job, agent) {
    if (job.status === "completed" && this.#reusable(job)) return;
    try {
      await agent.archive();
    } catch {
      job.cleanupUnconfirmed = true;
    }
  }

  async verifyTurn(job, agent, result) {
    if (!job.reusedWorker || result.status !== "idle") return result;
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
    return job.reusedWorker &&
      (job.ai.provider !== "antigravity" ||
        JSON.stringify(usage) === JSON.stringify(job.workerBoundary.usage))
      ? null
      : usage;
  }
}
