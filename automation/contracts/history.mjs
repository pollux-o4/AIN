import { z } from "zod";
import { activityStepSchema } from "./activity.mjs";

// 자원 사용량 합계 · tokens null = 기록 없음(0과 구분)
const cost = {
  ms: z.number(),
  tokens: z.number().nullable(),
  calls: z.number(),
  wasted: z.number(),
};
const outcome = z.enum(["accepted", "rejected", "failed", "running"]);
const usageSchema = z.object({
  ...cost,
  revisions: z.array(
    z.object({
      revision: z.number(),
      ...cost,
      stages: z.array(
        z.object({
          stage: z.string(),
          name: z.string(),
          ...cost,
          attempts: z.array(
            z.object({
              label: z.string(),
              ms: z.number(),
              tokens: z.number().nullable(),
              chars: z.number().nullable(),
              outcome,
            }),
          ),
        }),
      ),
    }),
  ),
  hotspots: z.array(
    z.object({
      label: z.string(),
      ms: z.number(),
      tokens: z.number().nullable(),
      outcome,
    }),
  ),
});

export const historySchema = z.object({
  usage: usageSchema,
  journey: z.array(
    z.object({
      revision: z.number(),
      request: z.string().nullable(),
      direction: z.array(
        z.object({ label: z.string(), text: z.string(), reason: z.string().nullable() }),
      ),
      summary: z.string().nullable(),
      findings: z.array(z.string()),
      hasDraft: z.boolean(),
    }),
  ),
  records: z.array(
    z.object({
      key: z.string(),
      at: z.number(),
      kind: z.string(),
      label: z.string(),
      revision: z.number(),
      stage: z.string(),
      name: z.string(),
      goal: z.string(),
      inputs: z.array(z.string()),
      inputsSource: z.enum(["recorded", "reconstructed", "unavailable"]),
      model: z.string().nullable(),
      executionId: z.string().nullable(),
      output: z.record(z.string(), z.unknown()).nullable(),
      resultSource: z.enum(["job", "artifact", "none"]),
      target: z.string().nullable(),
      reason: z.string().nullable(),
      unavailable: z.boolean(),
      // 끝난 AI 실행의 진행 기록 · 지도에서 단계를 눌러 다시 본다(LIVE-001 같은 비노출 규칙)
      steps: z.array(activityStepSchema).default([]),
    }),
  ),
});
