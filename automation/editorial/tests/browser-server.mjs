import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AUTO, DEFAULT_DIRECTION, directionSchema } from "../../contracts/writing-modes.mjs";
import { startIsolatedN8n } from "../../n8n/testing/runtime.mjs";
import { Jobs } from "../../paseo/index.mjs";
import { makeServer } from "../../runtime/server.mjs";
import { EditorialService, EditorialStore } from "../index.mjs";

export function fixtureOutputs(data) {
  const direction = directionSchema.parse(data.direction ?? DEFAULT_DIRECTION);
  const mode = direction.mode === AUTO ? "explain" : direction.mode;
  const secondaryMode = mode === "procedure" ? "explain" : "procedure";
  const readerLevel = direction.readerLevel === AUTO ? "beginner" : direction.readerLevel;
  return {
    diagnose: {
      purpose: "설명",
      audience: "초보 개발자",
      sectionModes: [mode, secondaryMode],
      preserveVoice: "의미 보존",
      strategy: "쇼핑몰 사례",
      primaryMode: mode,
      readerLevel,
    },
    topic: { problem: "쇼핑몰의 구조와 책임", scope: "주문·결제·배송" },
    audience: { reader: "초보 개발자", intent: "구조 선택의 이유 이해" },
    value: { outcome: "책임과 비용을 함께 판단", preserve: ["사용자의 목적과 목소리"] },
    research: {
      evidence: [],
      uncertainties: ["fixture 자료는 실제 사실 검증 결과가 아닙니다."],
    },
    outline: {
      sections: [
        { title: "주문", mode, keyPoint: "주문 상태와 책임을 나눕니다." },
        {
          title: "결제",
          mode: secondaryMode,
          keyPoint: "결제 요청과 확인 순서를 살펴봅니다.",
        },
        { title: "배송", mode, keyPoint: "결제와 배송의 연결을 정리합니다." },
      ],
      rationale: "책임과 연결 관계 순서",
    },
    route: {
      target: data.feedback?.includes("진단") ? "diagnose" : "draft",
      reason: "사용자가 요청한 수정 위치",
    },
    draft: {
      text: `# 쇼핑몰 아키텍처\n\n${data.feedback ? "수정한 초안입니다. 주문·결제·배송의 책임을 구체적으로 설명합니다." : "첫 초안입니다. 주문과 결제를 나누는 이유를 설명합니다."}\n\n요청: ${data.idea}\n\n[참고 자료](https://example.test/evidence)`,
      changeSummary: data.feedback
        ? "주문·결제·배송의 책임을 구체화했습니다."
        : "주문과 결제를 나누는 이유를 설명하는 초안을 작성했습니다.",
    },
    review: {
      findings: data.idea.includes("빈 검토") ? [] : ["용어와 사례가 연결되는지 확인해 주세요."],
      preservationCheck: "주문·결제·배송 사례 유지",
    },
  };
}

if (import.meta.main) {
  await mkdir(".local/editorial-e2e", { recursive: true });
  const root = await mkdtemp(resolve(".local/editorial-e2e/run-"));
  const port = 3356,
    n8nPort = 5728,
    token = "fixture-editorial-token-not-a-live-secret";
  const agents = new Map(),
    failed = new Set(),
    slowed = new Set();
  const client = {
    providers: {
      waitForReady: async () => ({
        entries: [{ provider: "fixture", status: "ready", models: [{ id: "fixture-model" }] }],
      }),
    },
    agents: {
      create: async (options) => {
        const data = JSON.parse(options.prompt.split("자료:\n")[1]);
        const stage = options.prompt.includes("피드백에 따라 가장 먼저")
          ? "route"
          : [
              "diagnose",
              "draft",
              "review",
              "outline",
              "topic",
              "audience",
              "value",
              "research",
            ].find((s) => options.prompt.includes(`${s} 산출물 반환`));
        const key = `${data.idea}:${stage}`;
        const slow = data.idea.includes("중단") && stage === "draft" && !slowed.has(key);
        if (slow) slowed.add(key);
        const broken = data.idea.includes("실패 복구") && stage === "draft" && !failed.has(key);
        if (broken) failed.add(key);
        agents.set(options.agentId, {
          created: Date.now(),
          delay: slow ? 15000 : data.idea.includes("실시간") && stage === "draft" ? 7000 : 500,
          broken,
          output: fixtureOutputs(data)[stage],
          stopped: false,
        });
        return { id: options.agentId };
      },
      ref: (id) => ({
        timeline: {
          subscribe(handler) {
            const timer = setInterval(() => handler({ event: { type: "timeline" } }), 180);
            const stop = () => clearInterval(timer);
            stop.ready = Promise.resolve();
            return stop;
          },
          async refetch() {
            const a = agents.get(id);
            const text = JSON.stringify(a.output);
            const elapsed = Date.now() - a.created;
            return {
              agent: { status: a.stopped ? "error" : elapsed < a.delay ? "running" : "idle" },
              entries: [
                {
                  timestamp: new Date(a.created + Math.min(elapsed, a.delay)).toISOString(),
                  item: {
                    type: "assistant_message",
                    text: text.slice(0, Math.max(24, Math.ceil((text.length * elapsed) / a.delay))),
                  },
                },
              ],
            };
          },
        },
        waitForFinish: async () => {
          const a = agents.get(id);
          if (a.stopped) return { status: "error", error: "cancelled" };
          if (Date.now() - a.created < a.delay) return { status: "timeout" };
          return { status: "idle", lastMessage: a.broken ? "not-json" : JSON.stringify(a.output) };
        },
      }),
    },
  };
  const jobs = new Jobs({
    client,
    root: join(root, "jobs"),
    workRoot: join(root, "work"),
    cancel: async (id) => {
      agents.get(id).stopped = true;
    },
  });
  const store = new EditorialStore(join(root, "state.sqlite"));
  let runtime;
  let starting;
  const service = new EditorialService({
    store,
    jobs,
    ai: { provider: "fixture", model: "fixture-model", enabled: true, maxDurationMs: 120000 },
    dispatch: (id) => runtime.dispatch(id),
  });
  // Legacy records are fixture-only; browsing must not trigger new AI sessions.
  for (const [index, device] of ["desktop", "mobile"].entries()) {
    const id = `00000000-0000-4000-8000-00000000000${index + 1}`;
    const at = Date.now();
    const text = `# 이전 초안 ${device}\n\n이전 3단계 원고를 그대로 보존합니다.`;
    store.save({
      id,
      requestId: `legacy-${device}`,
      ai: { provider: "fixture", model: "fixture-model", enabled: true, maxDurationMs: 120000 },
      state: {
        schemaVersion: 1,
        articleId: id,
        version: 4,
        revision: 1,
        status: "awaiting_user",
        stage: "review",
        plan: ["diagnose", "draft", "review"],
        idea: `이전 부분 초안 ${device}`,
        source: "사용자가 제공한 이전 자료",
        artifacts: {
          diagnose: {
            revision: 1,
            output: {
              purpose: "설명",
              audience: "작성자",
              sectionModes: ["explanation"],
              preserveVoice: "원문 유지",
              strategy: "명시적 보완",
            },
          },
          draft: { revision: 1, output: { text, changeSummary: "이전 초안" } },
          review: { revision: 1, output: { findings: [], preservationCheck: "이전 원고" } },
        },
        history: [],
        seen: {},
        approval: null,
        satisfiedRevision: null,
      },
      callsUsed: 3,
      maxCalls: 3,
      startedAt: at,
      updatedAt: at,
      operations: {},
      issue: null,
      issueKind: null,
      pending: null,
      queuedAt: at,
      worker: null,
      events: [],
    });
  }
  const server = makeServer({
    token,
    editorial: service,
    n8nUrl: `http://127.0.0.1:${n8nPort}`,
  });
  let stopping;
  function stop() {
    stopping ??= (async () => {
      for (const signal of ["SIGTERM", "SIGINT"]) process.off(signal, onSignal);
      const active = runtime ?? (await starting?.catch(() => null));
      await active?.stop();
      await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      });
      store.close();
    })();
    return stopping;
  }
  function onSignal() {
    void stop();
  }
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, onSignal);
  try {
    const n8nRoot = join(root, "n8n");
    await mkdir(n8nRoot, { mode: 0o700 });
    if (stopping) throw new Error("Fixture stopped during startup");
    starting = startIsolatedN8n({
      root: n8nRoot,
      port: n8nPort,
      bridgeUrl: `http://127.0.0.1:${port}`,
      token,
    });
    runtime = await starting;
    if (stopping) await stop();
    else {
      await new Promise((done, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", done);
      });
      console.log(`Isolated editorial UI ready: ${root}`);
    }
  } catch {
    console.error("Isolated editorial UI startup failed");
    await stop();
    process.exitCode = 1;
  }
}
