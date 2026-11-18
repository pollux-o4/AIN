// AI 응답 → 편집 이벤트: 과업별 형식 검사를 통과한 마지막 JSON만 결과로 인정
import { routeOutputSchema, stageOutputSchemas } from "../contracts/ai-output.mjs";
import { figureOutputSchemas } from "../contracts/figure.mjs";
import { parseLastValid } from "./result-blocks.mjs";

// 편집 메모 중 상태에 남길 부분 · 비어 있으면 생략
function memo({ level, priorities, preserve, assumptions, acceptance, requirementChanges }) {
  const value = { level, priorities, preserve, assumptions, acceptance, requirementChanges };
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

// 과업 종류별 형식과 이벤트 모양
const RESULTS = {
  request_route: {
    schema: () => routeOutputSchema,
    event: (_action, output) => ({
      type: "route",
      target: output.target,
      reason: output.reason,
      brief: memo(output),
    }),
  },
  request_figure: {
    schema: (action) => figureOutputSchemas[action.stage],
    event: (action, output) => ({
      type: "figure_result",
      stage: action.stage,
      ...(action.pass ? { pass: action.pass } : {}),
      output,
    }),
  },
  request_ai: {
    schema: (action) => stageOutputSchemas[action.stage],
    event: (action, output) => ({
      type: "complete",
      stage: action.stage,
      output,
      ...(action.section ? { section: action.section.index } : {}),
    }),
  },
};

export function resultEvent(job, message) {
  if (typeof message !== "string" || message.length > 1024 * 1024)
    throw new Error("Invalid or oversized AI result");
  const result = RESULTS[job.action.type] ?? RESULTS.request_ai;
  const schema = result.schema(job.action);
  if (!schema) throw new Error("Unsupported AI output stage");
  return {
    id: `${job.id}-result`,
    actor: "adapter",
    expectedVersion: job.state.version,
    revision: job.state.revision,
    ...result.event(job.action, parseLastValid(message, schema)),
  };
}
