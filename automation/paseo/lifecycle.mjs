// Paseo 세션 수명의 단일 정의: 소유 표시 · 담당 대기 세션 상한 · 끝난·고아 세션 정리 · ADR-0015
// 세션 하나가 제공자 프로세스 하나(agy 약 250MiB)를 잡으므로, 쓰지 않는 세션은 보관(archive)해 프로세스를 끝낸다.
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";

export const SESSION_SOURCE = "ain-n8n";

export const SESSION_POLICY = Object.freeze({
  // 담당 대기: 같은 글의 다음 단계가 곧 이어질 때만 이득 · 사람 피드백을 기다리는 동안은 내려놓는다
  warmIdleMs: 15 * 60_000,
  // 대기 세션 총량 상한 · 넘으면 오래 쉰 것부터 내려놓는다
  maxWarm: 6,
  // 막 끝난 세션은 결과 회수(poll) 전일 수 있어 건너뛴다
  graceMs: 2 * 60_000,
});

/** 세션 소유 표시 · owner = 이 런타임의 작업 저장소 절대 경로 */
export const sessionLabels = (/** @type {string} */ owner, /** @type {string} */ jobId) => ({
  source: SESSION_SOURCE,
  owner,
  job: jobId,
});

const LIVE_STATUSES = new Set(["running", "initializing"]);

export class SessionReaper {
  #client;
  #workers;
  #owner;
  #workRoot;
  #activeAgentIds;
  #policy;
  #now;
  #ownerAlive;

  /**
   * @param {{
   *   client: any, workers: import("./workers.mjs").Workers, owner: string, workRoot: string,
   *   activeAgentIds: () => Promise<Iterable<string>>, policy?: typeof SESSION_POLICY,
   *   now?: () => number, ownerAlive?: (owner: string) => boolean,
   * }} options
   */
  constructor({
    client,
    workers,
    owner,
    workRoot,
    activeAgentIds,
    policy = SESSION_POLICY,
    now = () => Date.now(),
    ownerAlive = existsSync,
  }) {
    this.#client = client;
    this.#workers = workers;
    this.#owner = resolve(owner);
    this.#workRoot = resolve(workRoot) + sep;
    this.#activeAgentIds = activeAgentIds;
    this.#policy = policy;
    this.#now = now;
    this.#ownerAlive = ownerAlive;
  }

  // 소유 표시가 없던 이전 세션: 이 런타임 작업 폴더 안이면 내 것, 밖이면 주인 없는 세션
  #ownerOf(agent) {
    if (agent.labels?.owner) return agent.labels.owner;
    return String(agent.cwd ?? "").startsWith(this.#workRoot) ? this.#owner : null;
  }

  #reclaimable(agent) {
    const owner = this.#ownerOf(agent);
    return owner === this.#owner || !owner || !this.#ownerAlive(owner);
  }

  async #archive(agentId) {
    try {
      await this.#client.agents.ref(agentId).archive();
      return true;
    } catch {
      return false;
    }
  }

  // 대기 세션 정리: 오래 쉰 것과 상한을 넘은 것을 내려놓고 남길 세션 ID를 돌려준다
  // AIN 표시 세션 전체 · createdAt 순 커서라 읽는 동안 항목이 밀리지 않는다
  async *#ainAgents() {
    let cursor;
    do {
      const page = await this.#client.agents.list({
        filter: { labels: { source: SESSION_SOURCE }, includeBackground: true },
        sort: [{ key: "created_at", direction: "desc" }],
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
      });
      for (const entry of page.entries) yield entry.agent;
      cursor = page.pageInfo?.nextCursor ?? undefined;
    } while (cursor);
  }

  async #trimWarm(keepNone) {
    const entries = (await this.#workers.list()).toSorted((a, b) => b.updatedAt - a.updatedAt);
    const kept = new Set();
    for (const entry of entries) {
      const fresh = this.#now() - entry.updatedAt < this.#policy.warmIdleMs;
      if (!keepNone && fresh && kept.size < this.#policy.maxWarm) {
        kept.add(entry.agentId);
        continue;
      }
      await this.#workers.dropEntry(entry);
    }
    return kept;
  }

  /**
   * 주기 정리: 대기 상한을 지키고, 진행 중 작업·대기 담당이 아닌 내 세션과 주인이 사라진 세션을 보관한다
   * @param {{ all?: boolean }} [options] all: 대기 세션까지 모두 내려놓음(종료 시)
   * @returns {Promise<{ archived: number, failed: number }>}
   */
  async sweep({ all = false } = {}) {
    const keep = new Set([...(await this.#trimWarm(all)), ...(await this.#activeAgentIds())]);
    const result = { archived: 0, failed: 0 };
    for await (const agent of this.#ainAgents()) {
      if (agent.archivedAt || LIVE_STATUSES.has(agent.status) || keep.has(agent.id)) continue;
      if (!all && this.#now() - Date.parse(agent.updatedAt) < this.#policy.graceMs) continue;
      if (!this.#reclaimable(agent)) continue;
      if (await this.#archive(agent.id)) result.archived += 1;
      else result.failed += 1;
    }
    return result;
  }
}
