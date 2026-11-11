import { z } from "zod";
import { readerLevelSchema, writingModeSchema } from "./writing-modes.mjs";

// Preserve provider extensions (including the pilot marker), also within evidence.
// Shape and nonempty content are canonical here; ordering/revision/approval belong to the domain.
const text = z.string().refine((value) => value.trim().length > 0, "Nonempty text required");
// explain 외 mode는 keyPoint만 필수 (FLOW-002 일괄 강제 제외). 세부 필드는 선택.
const sectionCard = z.looseObject({ title: text, mode: writingModeSchema, keyPoint: text });
export const stageOutputSchemas = {
  diagnose: z.looseObject({
    purpose: text,
    audience: text,
    sectionModes: z.array(text).min(1),
    preserveVoice: text,
    strategy: text,
    // 새 실행은 반환하고, 이전 실행 결과는 없어도 파싱 호환.
    primaryMode: writingModeSchema.optional(),
    readerLevel: readerLevelSchema.optional(),
  }),
  topic: z.looseObject({ problem: text, scope: text }),
  audience: z.looseObject({ reader: text, intent: text }),
  value: z.looseObject({ outcome: text, preserve: z.array(text) }),
  research: z
    .looseObject({
      evidence: z.array(z.looseObject({ claim: text, url: text })),
      uncertainties: z.array(text),
    })
    .refine(
      (value) => value.evidence.length > 0 || value.uncertainties.length > 0,
      "Research requires evidence or uncertainty",
    ),
  outline: z.looseObject({
    sections: z.array(z.union([text, sectionCard])).min(1),
    rationale: text,
  }),
  draft: z.looseObject({ text: text, changeSummary: text }),
  review: z.looseObject({ findings: z.array(text), preservationCheck: text }),
};
export const routeOutputSchema = z.looseObject({ target: z.string(), reason: z.string() });

/** @typedef {keyof typeof stageOutputSchemas} OutputStage */
/** @typedef {{ [K in OutputStage]: z.infer<(typeof stageOutputSchemas)[K]> }} StageOutputs */
/** @typedef {z.infer<typeof routeOutputSchema>} RouteOutput */

/**
 * Generate prompt placeholders from the same structural contract used for parsing.
 * @param {z.core.JSONSchema.JSONSchema | boolean} schema
 * @returns {unknown}
 */
function example(schema) {
  if (typeof schema === "boolean") return "string";
  if (Array.isArray(schema.enum)) return schema.enum.join("|");
  // 합집합은 가장 구조화된(마지막) 형식을 예시로 제시한다.
  const last = schema.anyOf?.at(-1);
  if (last !== undefined) return example(last);
  if (schema.type === "object")
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [key, example(value)]),
    );
  if (schema.type === "array" && schema.items && !Array.isArray(schema.items))
    return [example(schema.items)];
  return "string";
}
export const stageOutputExamples = Object.fromEntries(
  Object.entries(stageOutputSchemas).map(([stage, schema]) => [
    stage,
    example(z.toJSONSchema(schema)),
  ]),
);
export const routeOutputExample = example(z.toJSONSchema(routeOutputSchema));
