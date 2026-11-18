import { z } from "zod";

export const ACTIVITY_TEXT_LIMIT = 24000;
export const ACTIVITY_STEP_LIMIT = 40;
export const ACTIVITY_NOTE_LIMIT = 400;
// 공개 진행 기록: AI 설명 문장과 도구 종류·상태만 · 명령 인자·도구 원문·내부 추론 제외(LIVE-001)
export const activityStepSchema = z.object({
  kind: z.enum(["note", "tool"]),
  text: z.string().max(ACTIVITY_NOTE_LIMIT),
  status: z.enum(["running", "completed", "failed"]).optional(),
  at: z.number().nullable(),
});
export const activitySchema = z.object({
  revision: z.number(),
  stage: z.string(),
  name: z.string(),
  active: z.boolean(),
  phase: z.enum([
    "queued",
    "waiting",
    "generating",
    "tool",
    "validating",
    "permission",
    "failed",
    "unavailable",
    "complete",
    "paused",
  ]),
  text: z.string().max(ACTIVITY_TEXT_LIMIT),
  truncated: z.boolean(),
  lastOutputAt: z.number().nullable(),
  steps: z.array(activityStepSchema).max(ACTIVITY_STEP_LIMIT).default([]),
});
