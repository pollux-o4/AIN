// 요구사항 목록 계약: 요구 종류 등록 · 변경 한 건의 형식 · 표시 · ADR-0016
// 새 종류 = REQUIREMENT_KINDS에 항목 하나(값 형식·표시) · 셀 수 있으면 domain/requirements CHECKS에 검사기 하나
import { z } from "zod";
import { readerLevelSchema, writingModeSchema } from "./writing-modes.mjs";

const lengthValue = z
  .object({
    min: z.coerce.number().int().min(0),
    max: z.coerce.number().int().positive().nullable(),
  })
  .refine((v) => v.max === null || v.min <= v.max, "min <= max");

/** @type {Record<string, { label: string, value: z.ZodType, show: (value: any) => string }>} */
const REQUIREMENT_KINDS = Object.freeze({
  length: {
    label: "분량",
    value: lengthValue,
    show: ({ min, max }) => (max === null ? `${min}자 이상` : `${min}~${max}자`),
  },
  mode: { label: "서술 방식", value: writingModeSchema, show: String },
  readerLevel: { label: "독자 수준", value: readerLevelSchema, show: String },
});

// 등록되지 않은 종류: 사람 말로 적은 요구(어조·범위·금지 사항 등) · 검토 점검표가 판정
const textValue = z.string().trim().min(1);
export const valueSchemaOf = (/** @type {string} */ kind) =>
  REQUIREMENT_KINDS[kind]?.value ?? textValue;

export const requirementChangeSchema = z.looseObject({
  kind: z
    .string()
    .trim()
    .min(1)
    .describe(
      `요구 종류를 적는다. ${Object.keys(REQUIREMENT_KINDS).join("|")} 또는 짧은 영문 이름(tone·scope 등) 가운데 하나를 쓴다.`,
    ),
  op: z.enum(["set", "lift"]).describe("적용할 동작으로 set(설정·변경) 또는 lift(해제)를 적는다."),
  value: z
    .unknown()
    .optional()
    .describe(
      "op가 set일 때 적용할 값을 적는다. length는 공백 포함 글자 수인 {min, max|null} 형식으로, mode와 readerLevel은 정해진 값으로, 그 밖의 종류는 요구 문장으로 적는다.",
    ),
  quote: z.string().trim().min(1).describe("근거가 된 사용자 말의 원문을 그대로 적는다."),
});

/** @typedef {z.infer<typeof requirementChangeSchema>} RequirementChange */

/** 화면·CLI 표시 한 줄 */
export function describeRequirement(/** @type {string} */ kind, /** @type {unknown} */ value) {
  const entry = REQUIREMENT_KINDS[kind];
  return `${entry?.label ?? kind}: ${entry ? entry.show(value) : String(value)}`;
}

export function describeChange(/** @type {RequirementChange} */ change) {
  return change.op === "lift"
    ? `${REQUIREMENT_KINDS[change.kind]?.label ?? change.kind}: 제한 해제`
    : describeRequirement(change.kind, change.value);
}
