import { join } from "node:path";
import { AUTO, DEFAULT_DIRECTION, directionSchema } from "../../contracts/writing-modes.mjs";
import { inProcessDispatcher } from "../../n8n/testing/in-process.mjs";
import { Jobs } from "../../paseo/index.mjs";
import { promptData, promptTask } from "../../paseo/prompts/index.mjs";
import { scratchDir } from "../../runtime/scratch.mjs";
import { makeServer } from "../../runtime/server.mjs";
import { EditorialService, EditorialStore } from "../index.mjs";
import { STORY } from "./story-card.mjs";

// 실시간 fixture: 초고는 HELD_MS 동안 진행 중(테스트 제한 90초보다 김) · 내용은 STREAM_MS에 걸쳐 흘러나옴
const HELD_MS = 120000;
const STREAM_MS = 7000;

// 시각자료 fixture: 실제 AI가 아닌 고정 도식 · 앵커는 fixture 초안의 문장 그대로
const figureSvg = (title, steps) =>
  `<svg viewBox="0 0 640 220" role="img"><rect width="640" height="220" fill="#ffffff"/>` +
  `<text x="320" y="36" text-anchor="middle" font-size="18" font-weight="700" fill="#1e1b2e">${title}</text>` +
  steps
    .map((step, i) => {
      const x = 40 + i * (560 / steps.length);
      const width = 560 / steps.length - 30;
      return (
        `<rect x="${x}" y="80" width="${width}" height="70" fill="#dfe3fb" stroke="#1e1b2e" stroke-width="3"/>` +
        `<text x="${x + width / 2}" y="122" text-anchor="middle" font-size="17" fill="#1e1b2e">${step}</text>` +
        (i < steps.length - 1
          ? `<path d="M${x + width + 4} 115 h22 m-8 -8 l8 8 l-8 8" stroke="#1e1b2e" stroke-width="3" fill="none"/>`
          : "")
      );
    })
    .join("") +
  "</svg>";
const FIGURE_ANCHORS = [
  [
    "주문은 고객이 무엇을 샀는지 기록하는 책임을 집니다.",
    "주문·결제·배송의 책임 흐름",
    ["주문", "결제", "배송"],
  ],
  [
    "결제는 요청을 보낸 뒤 승인 결과를 확인하는 두 단계로 진행됩니다.",
    "결제 요청과 확인의 순서",
    ["결제 요청", "승인 확인"],
  ],
];
function figureOutputs(data) {
  return {
    figure_plan: {
      candidates: [
        ...FIGURE_ANCHORS.map(([anchor, claim]) => ({
          anchor,
          claim,
          reason: "이유",
          scene: "장면",
          kind: "diagram",
        })),
        // 본문에 없는 문장: 화면에 후보로 나오면 안 됨
        {
          anchor: "초안에 없는 문장입니다.",
          claim: "버려져야 하는 후보",
          reason: "이유",
          scene: "장면",
        },
      ],
    },
    figure: {
      figures: (data.candidates ?? []).map(({ id, anchor, claim }) => ({
        id,
        svg: figureSvg(claim, FIGURE_ANCHORS.find(([a]) => a === anchor)?.[2] ?? ["?"]),
        alt: `${claim}을 왼쪽에서 오른쪽으로 이어지는 상자로 나타낸 도식`,
        caption: claim,
      })),
    },
  };
}

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
        { title: "주문", mode, keyPoint: "주문 상태와 책임을 나눕니다.", ...STORY },
        {
          title: "결제",
          mode: secondaryMode,
          keyPoint: "결제 요청과 확인 순서를 살펴봅니다.",
          ...STORY,
        },
        { title: "배송", mode, keyPoint: "결제와 배송의 연결을 정리합니다.", ...STORY },
      ],
      rationale: "책임과 연결 관계 순서",
    },
    route: {
      target: data.feedback?.includes("진단") ? "diagnose" : "draft",
      reason: data.feedback?.includes("해석 보정")
        ? "보정 의견을 반영한 수정 의도"
        : "사용자가 요청한 수정 위치",
      level: "line",
      priorities: ["주문·결제·배송 사례 구체화"],
      preserve: ["쇼핑몰 예시"],
      assumptions: ["문장 수준 수정으로 충분하다고 가정"],
    },
    draft: {
      text: `# 쇼핑몰 아키텍처\n\n${data.feedback ? "수정한 초안입니다. 주문·결제·배송의 책임을 구체적으로 설명합니다." : "첫 초안입니다. 주문과 결제를 나누는 이유를 설명합니다."}\n\n요청: ${data.idea}\n\n${
        data.idea.includes("시각자료")
          ? `## 주문\n\n${FIGURE_ANCHORS[0][0]} 결제와 배송은 이 기록을 기준으로 움직입니다.\n\n## 결제\n\n${FIGURE_ANCHORS[1][0]} 확인이 끝나야 배송이 시작됩니다.\n\n`
          : ""
      }[참고 자료](https://example.test/evidence)`,
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
  const scratch = await scratchDir("editorial-e2e");
  const root = scratch.path;
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
        const data = promptData(options.prompt);
        const stage = promptTask(options.prompt);
        const key = `${data.idea}:${stage}`;
        const slow = data.idea.includes("중단") && stage === "draft" && !slowed.has(key);
        if (slow) slowed.add(key);
        const broken = data.idea.includes("실패 복구") && stage === "draft" && !failed.has(key);
        if (broken) failed.add(key);
        agents.set(options.agentId, {
          created: Date.now(),
          // 실시간 테스트는 중단으로 끝난다 · 초고가 테스트보다 먼저 끝나면 중단할 대상이 사라지므로
          // 테스트 제한 시간보다 길게 잡는다(벽시계 경주에 기대지 않음 · TIME-001) · 내용은 STREAM_MS 동안 흘러나온다
          delay: slow ? 15000 : data.idea.includes("실시간") && stage === "draft" ? HELD_MS : 50,
          broken,
          output: (stage.startsWith("figure") ? figureOutputs(data) : fixtureOutputs(data))[stage],
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
                // 공개 진행 기록 fixture: 설명 문장 → 도구 실행(인자는 화면에 나오면 안 됨) → 결과 JSON
                {
                  timestamp: new Date(a.created).toISOString(),
                  item: { type: "assistant_message", text: "자료를 읽고 구성을 잡겠습니다." },
                },
                {
                  timestamp: new Date(a.created).toISOString(),
                  item: {
                    type: "tool_call",
                    name: "shell",
                    status: elapsed < a.delay / 2 ? "running" : "completed",
                    detail: { type: "read", filePath: "private-fixture-path.md" },
                  },
                },
                {
                  timestamp: new Date(a.created + Math.min(elapsed, a.delay)).toISOString(),
                  item: {
                    type: "assistant_message",
                    text: text.slice(
                      0,
                      Math.max(
                        24,
                        Math.ceil((text.length * elapsed) / Math.min(a.delay, STREAM_MS)),
                      ),
                    ),
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
    cancelAgent: async (id) => {
      agents.get(id).stopped = true;
    },
  };
  const jobs = new Jobs({
    client,
    root: join(root, "jobs"),
    workRoot: join(root, "work"),
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
      await scratch.release();
    })();
    return stopping;
  }
  function onSignal() {
    void stop();
  }
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, onSignal);
  try {
    if (stopping) throw new Error("Fixture stopped during startup");
    // 화면 e2e는 n8n과 같은 계약의 프로세스 내 전달자 사용 · n8n 연결은 test:n8n:runtime 담당
    starting = Promise.resolve(inProcessDispatcher(service));
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
