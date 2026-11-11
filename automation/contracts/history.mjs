import { z } from "zod";

export const historySchema = z.object({
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
    }),
  ),
});
