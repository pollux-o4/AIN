import { z } from "zod";

export const ACTIVITY_TEXT_LIMIT = 24000;
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
});
