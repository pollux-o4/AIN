import { stageOutputExamples } from "../../../automation/contracts/ai-output.mjs";
import { STORY } from "../../../automation/editorial/tests/story-card.mjs";
import { promptData, promptTask } from "../../../automation/paseo/prompts/index.mjs";

export const provider = "fixture";
export const model = "fixture-model";
export const idea = "쇼핑몰 책임 분리 설명과 시각자료";
export const completionDelayMs = 75;
export const completionClock = () => performance.timeOrigin + performance.now();

const anchors = [
  "주문은 고객이 무엇을 샀는지 기록하는 책임을 집니다.",
  "결제는 요청을 보낸 뒤 승인 결과를 확인하는 두 단계로 진행됩니다.",
];
const writing = {
  ...stageOutputExamples,
  diagnose: {
    ...stageOutputExamples.diagnose,
    primaryMode: "explain",
    readerLevel: "beginner",
    requirementChanges: [],
  },
  outline: {
    sections: [
      { title: "주문", mode: "explain", keyPoint: anchors[0], ...STORY },
      { title: "결제", mode: "explain", keyPoint: anchors[1], ...STORY },
    ],
    rationale: "책임 순서",
  },
  draft: {
    text: `# 쇼핑몰의 책임\n\n## 주문\n\n${anchors[0]}\n\n## 결제\n\n${anchors[1]}`,
    changeSummary: "초안",
  },
  review: { findings: [], preservationCheck: "책임 설명 유지", verdict: "pass" },
};
const svg = '<svg viewBox="0 0 64 32"><rect width="64" height="32"/></svg>';

export function fixtureReply(prompt) {
  const stage = promptTask(prompt);
  const data = promptData(prompt);
  switch (stage) {
    case "figure_plan":
      return {
        candidates: anchors.map((anchor) => ({ anchor, claim: anchor, reason: "책임 설명" })),
      };
    case "figure_compose":
      return {
        world: "쇼핑몰",
        designs: data.candidates.map(({ id }) => ({ id, scene: "책임 도식" })),
      };
    case "figure":
      return { figures: data.candidates.map(({ id }) => ({ id, svg, alt: "책임 도식" })) };
    default:
      return writing[stage];
  }
}

export function syntheticClient() {
  const agents = new Map();
  let subscriptions = 0;
  const client = {
    providers: {
      async waitForReady() {
        return { entries: [{ provider, status: "ready", models: [{ id: model }] }] };
      },
    },
    agents: {
      async create({ agentId, prompt, labels }) {
        const output = fixtureReply(prompt);
        const handlers = new Set();
        const agent = {
          id: agentId,
          labels,
          status: "running",
          signal: null,
          checked: null,
          async archive() {
            agent.archivedAt = new Date().toISOString();
          },
          async waitForFinish() {
            if (!agent.signal) return { status: "timeout" };
            agent.checked ??= completionClock();
            return { status: "idle", lastMessage: JSON.stringify(output) };
          },
          timeline: {
            subscribe(handler) {
              subscriptions++;
              handlers.add(handler);
              const stop = () => {
                if (handlers.delete(handler)) subscriptions--;
              };
              stop.ready = Promise.resolve();
              return stop;
            },
            async refetch() {
              return { agent, entries: [] };
            },
          },
        };
        agents.set(agentId, agent);
        setTimeout(() => {
          agent.signal = completionClock();
          agent.status = "idle";
          agent.updatedAt = new Date().toISOString();
          for (const handler of handlers) handler({ event: { type: "timeline" } });
        }, completionDelayMs).unref();
        return agent;
      },
      ref(id) {
        return agents.get(id);
      },
      async list() {
        return { entries: [...agents.values()].map((agent) => ({ agent })) };
      },
    },
  };
  return {
    client,
    timing(id) {
      const { signal, checked } = agents.get(id);
      return { signal, checked };
    },
    counts() {
      const open = [...agents.values()].filter((agent) => !agent.archivedAt);
      return {
        subscriptions,
        runningSessions: open.filter((agent) => agent.status === "running").length,
        idleSessions: open.filter((agent) => agent.status === "idle").length,
        goroutines: null,
      };
    },
  };
}
