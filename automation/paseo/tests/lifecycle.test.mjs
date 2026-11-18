import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SESSION_POLICY, SESSION_SOURCE, SessionReaper, sessionLabels } from "../lifecycle.mjs";
import { Workers } from "../workers.mjs";

// 검증: ADR-0015 세션 수명 · 표시·대기 상한·유예·주인 판정
const OWNER = "/runtime/jobs";
const WORK = "/runtime/workspaces";
const NOW = Date.parse("2026-11-17T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();

async function setup(t, agents, { active = [], alive = [OWNER] } = {}) {
  const root = await mkdtemp(join(tmpdir(), "ain-lifecycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archived = [];
  const client = {
    agents: {
      list: async ({ filter }) => {
        assert.equal(filter.labels.source, SESSION_SOURCE);
        return { entries: agents.map((agent) => ({ agent })), pageInfo: { nextCursor: null } };
      },
      ref: (id) => ({
        archive: async () => {
          if (id === "stuck") throw new Error("archive failed");
          archived.push(id);
        },
      }),
    },
  };
  const workers = new Workers(root);
  const reaper = new SessionReaper({
    client,
    workers,
    owner: OWNER,
    workRoot: WORK,
    activeAgentIds: async () => active,
    now: () => NOW,
    ownerAlive: (owner) => alive.includes(owner),
  });
  return { reaper, workers, archived };
}

const agent = (id, extra = {}) => ({
  id,
  status: "idle",
  updatedAt: ago(10 * 60_000),
  labels: sessionLabels(OWNER, `job-${id}`),
  ...extra,
});

test("lifecycle: 진행 중 작업·실행 중·유예 안 세션은 남기고 끝난 내 세션은 보관한다", async (t) => {
  const f = await setup(
    t,
    [
      agent("done"),
      agent("active"),
      agent("running", { status: "running" }),
      agent("fresh", { updatedAt: ago(30_000) }),
      agent("gone", { archivedAt: ago(1000) }),
    ],
    { active: ["active"] },
  );
  assert.deepEqual(await f.reaper.sweep(), { archived: 1, failed: 0 });
  assert.deepEqual(f.archived, ["done"]);
});

test("lifecycle: 대기 담당은 유휴 시간 안·상한 안만 남기고 나머지는 내려놓는다", async (t) => {
  const f = await setup(t, []);
  const ids = Array.from({ length: SESSION_POLICY.maxWarm + 2 }, (_v, i) => `w${i}`);
  for (const id of ids) await f.workers.put(`article-${id}`, "writer", { agentId: id });
  const list = await f.workers.list();
  const reaper = new SessionReaper({
    client: { agents: { list: async () => ({ entries: [], pageInfo: {} }) } },
    workers: f.workers,
    owner: OWNER,
    workRoot: WORK,
    activeAgentIds: async () => [],
    // 모두 방금 등록됨 → 유휴 시간 안 · 상한만 작동
    now: () => Math.max(...list.map((e) => e.updatedAt)) + 1,
  });
  await reaper.sweep();
  assert.equal((await f.workers.list()).length, SESSION_POLICY.maxWarm);
  await reaper.sweep({ all: true });
  assert.equal((await f.workers.list()).length, 0, "종료 시 대기 담당도 모두 내려놓음");
});

test("lifecycle: 남긴 대기 담당 세션은 보관하지 않고, 유휴 시간을 넘긴 담당은 세션까지 보관한다", async (t) => {
  const f = await setup(t, [agent("warm"), agent("idle-warm")]);
  await f.workers.put("a", "writer", { agentId: "warm" });
  await f.workers.put("b", "writer", { agentId: "idle-warm" });
  const entry = (await f.workers.list()).find((e) => e.agentId === "idle-warm");
  // 유휴 시간 초과를 흉내: 기록 시각을 정책보다 오래 전으로
  const reaper = new SessionReaper({
    client: {
      agents: {
        list: async () => ({
          entries: [agent("warm"), agent("idle-warm")].map((a) => ({ agent: a })),
          pageInfo: {},
        }),
        ref: (id) => ({ archive: async () => f.archived.push(id) }),
      },
    },
    workers: {
      list: async () =>
        (await f.workers.list()).map((e) =>
          e === entry || e.agentId === "idle-warm"
            ? { ...e, updatedAt: NOW - SESSION_POLICY.warmIdleMs - 1 }
            : { ...e, updatedAt: NOW },
        ),
      dropEntry: (e) => f.workers.dropEntry(e),
    },
    owner: OWNER,
    workRoot: WORK,
    activeAgentIds: async () => [],
    now: () => NOW,
  });
  await reaper.sweep();
  assert.deepEqual(f.archived, ["idle-warm"]);
  assert.equal(await f.workers.get("a", "writer").then((w) => w.agentId), "warm");
  assert.equal(await f.workers.get("b", "writer"), null);
});

test("lifecycle: 주인이 살아 있는 남의 세션은 두고, 주인이 사라졌거나 표시 없는 바깥 세션은 보관한다", async (t) => {
  const other = "/other/jobs";
  const f = await setup(
    t,
    [
      agent("other-live", { labels: sessionLabels(other, "j") }),
      agent("other-dead", { labels: sessionLabels("/deleted/jobs", "j") }),
      agent("legacy-mine", { labels: { source: SESSION_SOURCE }, cwd: `${WORK}/abc` }),
      agent("legacy-outside", { labels: { source: SESSION_SOURCE }, cwd: "/tmp/run/work/abc" }),
      agent("stuck"),
    ],
    { alive: [OWNER, other] },
  );
  assert.deepEqual(await f.reaper.sweep(), { archived: 3, failed: 1 });
  assert.deepEqual(f.archived.toSorted(), ["legacy-mine", "legacy-outside", "other-dead"]);
});
