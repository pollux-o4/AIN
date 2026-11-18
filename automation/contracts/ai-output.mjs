import { z } from "zod";
import { requirementChangeSchema } from "./requirements.mjs";
import { slotGuide } from "./slot-rules.mjs";
import { CASE_ORIGINS, readerLevelSchema, writingModeSchema } from "./writing-modes.mjs";

// Preserve provider extensions (including the pilot marker), also within evidence.
// Shape and nonempty content are canonical here; ordering/revision/approval belong to the domain.
const text = z.string().refine((value) => value.trim().length > 0, "Nonempty text required");
// 채울 항목 안내: 형식과 같은 곳에 적어 프롬프트 예시가 그대로 가져감(항목 이름·뜻의 단일 정의) · ADR-0013
/** @template {z.ZodType} [T=typeof text] @param {string} guide @param {T} [schema] @returns {T} */
const slot = (guide, schema) => /** @type {T} */ ((schema ?? text).describe(guide));
const list = (/** @type {string} */ guide) => z.array(slot(guide));
// 선택 항목: 해당 없음을 빈 문자열·null로 돌려주는 모델이 있다(실측: 첫 구간 prerequisite "" 하나로 구성 전체가 형식 오류)
// 비어 있으면 없는 항목으로 읽는다 · 필수 항목은 그대로 빈 값을 거부
/** @template {z.ZodType} T @param {T} schema */
const maybe = (schema) =>
  z.preprocess(
    (value) => (value === null || (typeof value === "string" && !value.trim()) ? undefined : value),
    schema.optional(),
  );
// explain 외 mode는 keyPoint만 필수 (FLOW-002 일괄 강제 제외). 세부 필드는 선택.
// 판단 보조 필드: 형식이 틀리면 그 필드만 버리고 핵심 결과는 살림 · 실측: 메모 필드 하나로 회차 전체 실패
/** @template {z.ZodType} T @param {T} schema */
const advisory = (schema) => schema.optional().catch(undefined);
// 구간 카드: 구성이 항목을 채우고 초고는 항목을 문장으로 옮김 · 이전 실행 결과는 항목이 없어도 파싱 호환
// 설명 카드(concrete~checkQuestion) RES-005 · 구간 카드(hook~underline) RES-007 · 필수 여부는 domain/sections가 판정
// 하위 항목: 구간 안 나란한 항목 · 내용의 포함 관계만큼 다시 나뉜다(깊이 상한 없음) · ADR-0014
/** @type {z.ZodType<{ title: string, keyPoint?: string, subsections?: unknown[] }>} */
const subsectionCard = z.lazy(() =>
  z.looseObject({
    title: slot(
      "독자가 다시 찾아볼 대상을 짧은 이름으로 쓴 하위 항목의 소제목이다. 같은 단계의 항목끼리 같은 형태로 쓴다.",
    ),
    keyPoint: maybe(slot("이 하위 항목이 전할 핵심 내용 1문장을 적는다.")),
    // 형식이 어긋나면 하위 항목만 버리고 구간은 살린다(예시 문구를 그대로 옮긴 응답 등)
    subsections: z.array(subsectionCard).optional().catch(undefined),
  }),
);
const sectionCard = z.looseObject({
  title: slot(
    "독자가 이 구간에서 얻을 답을 짧고 자연스러운 말로 담은 소제목이다. 정해진 문형(예: 콜론으로 이름과 결론을 잇는 틀)에 맞추지 않는다.",
  ),
  mode: writingModeSchema,
  keyPoint: slot("이 구간에서 전할 핵심 원칙 하나를 1문장으로 적는다."),
  level: readerLevelSchema.optional(),
  optional: z.boolean().optional(),
  prerequisite: maybe(slot("이 구간보다 먼저 이해해야 할 앞 구간의 소제목을 적는다.")),
  concrete: maybe(
    slot("explain 구간에서만 쓰며, 정의와 함께 보여 줄 구체적인 대상(예시·그림 소재)을 적는다."),
  ),
  walkthrough: maybe(slot("explain 구간에서만 쓰며, 단계별로 따라가는 예제를 적는다.")),
  refute: maybe(slot("explain 구간에서만 쓰며, 바로잡을 오해와 올바른 설명을 적는다.")),
  checkQuestion: maybe(
    slot("explain 구간에서만 쓰며, 본문 내용만으로 답할 수 있는 확인 질문을 적는다."),
  ),
  hook: maybe(slot(slotGuide("hook"))),
  cases: list(
    "원칙을 직접 설명하지 않고 장면으로 보여 주는 사례다. 주인공이 언제·어디서 무엇을 했고 눈에 보이는 결과가 어땠는지를 2~3문장으로 적는다.",
  ).optional(),
  principleLine: maybe(slot(slotGuide("principleLine"))),
  underline: maybe(slot(slotGuide("underline"))),
  subsections: z
    .array(subsectionCard)
    .optional()
    .catch(undefined)
    .describe("대등한 하위 항목이 2개 이상일 때만 적고, 그렇지 않으면 생략한다."),
  // 구간 글자 예산 · 구간별 초고가 사용 · ADR-0009
  budget: advisory(
    z.coerce.number().int().positive().describe("공백을 포함한 글자 수(정수)를 적는다."),
  ),
});
export const stageOutputSchemas = {
  diagnose: z.looseObject({
    purpose: slot("이 글이 독자에게 해 줄 역할 1문장을 적는다."),
    audience: slot("예상 독자가 누구이고 어떤 상황에 있는지 1문장으로 적는다."),
    sectionModes: z.array(slot("예상되는 각 구간의 서술 방식을 적는다.")).min(1),
    preserveVoice: slot(
      "글 전체에 일관되게 쓸 문체(종결어미)와 시점 하나를 적는다(예: 합니다체·독자에게 직접 / 한다체·1인칭).",
    ),
    strategy: slot("글을 쓰는 방향과 사용자가 밝힌 조건(분량·금지 사항 등)을 적는다."),
    // 새 실행은 반환하고, 이전 실행 결과는 없어도 파싱 호환.
    primaryMode: writingModeSchema.optional(),
    readerLevel: readerLevelSchema.optional(),
    // 글감 문장에 사용자가 건 요구 → 요구사항 목록 · 형식이 틀리면 이 항목만 버림 · ADR-0016
    requirementChanges: advisory(z.array(requirementChangeSchema)),
  }),
  topic: z.looseObject({
    problem: slot("독자가 겪는 문제 하나를 독자가 쓰는 말로 1문장으로 적는다."),
    scope: slot("이 글에서 다룰 내용과 다루지 않을 내용을 구분해 적는다."),
    titleCandidates: list(
      `제목 후보를 약속형·궁금증형·경고형 순서로 각각 1개씩 적는다. 각 후보는 ${slotGuide("title")}`,
    ).optional(),
  }),
  // RES-005 독자 카드·범위 · 선택 필드라 이전 결과도 파싱 호환
  audience: z.looseObject({
    reader: slot("대상 독자가 누구이고 어떤 상황에 있는지 적는다."),
    intent: slot("독자가 이 글에서 얻으려는 목적을 적는다."),
    readerTask: maybe(slot("독자가 글을 읽은 뒤 할 수 있게 될 일을 1문장으로 적는다.")),
    knows: list("독자가 이미 알고 있는 배경지식을 적는다.").optional(),
    unknownTerms: list("독자가 모를 만한 전문 용어를 적는다.").optional(),
    misconceptions: list("독자가 흔히 갖는 오해를 적는다.").optional(),
    homonyms: list("이름은 같지만 실제 대상이 다른 개념을 적는다.").optional(),
    scene: maybe(
      slot(
        "독자가 이 문제를 겪는 구체적 상황 하나다. 독자가 무엇을 하려다 어디에서 막히는지 적는다.",
      ),
    ),
  }),
  value: z.looseObject({
    outcome: slot("readerTask를 이룬 결과 1문장을 적는다."),
    preserve: list("글감과 원문에서 꼭 지켜야 할 내용을 적는다."),
    excluded: list("이번 글의 범위에서 뺄 내용을 적는다.").optional(),
    promise: maybe(
      slot(
        "독자에게 건네는 약속 문장 1개로, 글을 읽고 나면 할 수 있는 일을 담되 종결어미는 diagnose.preserveVoice를 따른다.",
      ),
    ),
  }),
  research: z
    .looseObject({
      evidence: z.array(
        z.looseObject({
          claim: slot("글의 근거가 되는 사실 1문장을 적는다."),
          url: slot(
            "자료에 적힌 출처 주소를 그대로 적고, 출처 주소가 없으면 '사용자 제공 자료'라고 적는다.",
          ),
        }),
      ),
      uncertainties: z.array(slot("자료만으로 확인하지 못한 내용을 적는다.")),
      // 사례 후보: 지어낸 것은 hypothetical → 본문에서 '가상의 예' 표시 대상 · RES-007 S6·S10
      cases: advisory(
        z.array(
          z.looseObject({
            text: slot(
              "주인공이 언제·어디서 무엇을 했고 눈에 보이는 결과(사물·횟수·시간 등)가 어땠는지를 담은 사례 장면 2~3문장을 적는다. 교훈은 적지 않는다.",
            ),
            origin: z.enum(CASE_ORIGINS),
          }),
        ),
      ),
    })
    .refine(
      (value) => value.evidence.length > 0 || value.uncertainties.length > 0,
      "Research requires evidence or uncertainty",
    ),
  outline: z.looseObject({
    title: maybe(
      slot(`topic.titleCandidates에서 고른 글 제목을 그대로 적는다. ${slotGuide("title")}`),
    ),
    sections: z.array(z.union([text, sectionCard])).min(1),
    rationale: slot("구간을 이 순서로 놓은 이유를 적는다."),
    analogySystem: z
      .looseObject({
        source: slot(
          "독자가 바로 떠올리는 일상 사물 하나가 글 전체의 개념과 직접 맞닿을 때 그 사물을 적는다. 그런 사물이 없으면 analogySystem을 생략한다.",
        ),
        mapping: list("비유의 각 부분과 개념의 각 부분이 어떻게 대응하는지 적는다."),
        limits: list("비유가 실제 개념과 맞지 않는 한계를 적는다."),
      })
      .optional(),
  }),
  draft: z.looseObject({
    text: slot("마크다운 형식의 본문을 적는다."),
    changeSummary: slot("무엇을 쓰거나 고쳤는지 1문장으로 적는다."),
  }),
  // 합격 판정(데스크 체크): 편집 메모 합격 기준 대비 · 선택 필드라 이전 결과도 파싱 호환 · ADR-0008
  review: z.looseObject({
    findings: z.array(slot("기준 ID, 해당 구간, 문제 표현 인용, 사유를 순서대로 적는다.")),
    preservationCheck: slot(
      "핵심 내용을 독자의 말로 3문장으로 다시 쓰고, 원문과 어긋나는 점을 적는다.",
    ),
    // 기준별 점검표 · 프롬프트가 준 기준 ID마다 1개 · ADR-0013
    checks: advisory(
      z.array(
        z.looseObject({
          id: slot("기준 ID를 적는다."),
          pass: z.boolean(),
          note: maybe(slot("판정의 근거가 된 본문 표현이나 측정값을 적는다.")),
        }),
      ),
    ),
    verdict: advisory(z.enum(["pass", "revise"])),
    reviseFrom: advisory(
      z.string().describe("verdict가 revise이면 다시 시작할 단계(outline|draft)를 적는다."),
    ),
    unmetCriteria: advisory(list("verdict가 revise이면 충족하지 못한 기준을 적는다.")),
  }),
};

// 편집 수준: 구조(developmental) → 문장(line) → 교열(copy) · 수준이 복귀 범위를 정함 · RES-006
const EDIT_LEVELS = /** @type {const} */ (["developmental", "line", "copy"]);
// 편집 메모: 사람 피드백을 의도·우선순위·보존·합격 기준으로 번역 · reason은 의도 · ADR-0008
export const routeOutputSchema = z.looseObject({
  target: z.string().describe("다시 시작할 단계 이름을 적는다."),
  reason: z.string().describe("수정 의도를 담은 1문장을 적는다."),
  level: advisory(z.enum(EDIT_LEVELS)),
  priorities: advisory(list("고칠 사항을 중요도 순서대로 최대 5개 적는다.")),
  preserve: advisory(list("현재 잘 쓰여 그대로 둘 사항을 적는다.")),
  assumptions: advisory(list("근거 없이 임의로 판단한 사항을 적는다.")),
  acceptance: advisory(
    z.looseObject({
      criteria: advisory(
        list("다음 결과가 충족해야 할 기준을 예/아니오로 가릴 수 있는 문장으로 적는다."),
      ),
    }),
  ),
  // 피드백이 세우거나 바꾸거나 푼 요구 · 해석 승인 시 요구사항 목록에 반영 · ADR-0016
  requirementChanges: advisory(z.array(requirementChangeSchema)),
});

/** @typedef {keyof typeof stageOutputSchemas} OutputStage */
/** @typedef {{ [K in OutputStage]: z.infer<(typeof stageOutputSchemas)[K]> }} StageOutputs */
/** @typedef {z.infer<typeof routeOutputSchema>} RouteOutput */

/**
 * Generate prompt placeholders from the same structural contract used for parsing.
 * @param {z.core.JSONSchema.JSONSchema | boolean} schema
 * @returns {unknown}
 */
function example(schema, root = schema, seen = new Set()) {
  if (typeof schema === "boolean") return "string";
  // 재귀 형식(하위 항목)은 한 번만 펼친다
  if (typeof schema.$ref === "string") {
    if (seen.has(schema.$ref)) return "(필요하면 위와 같은 구조로 하위 항목을 더한다)";
    const name = schema.$ref.split("/").at(-1) ?? "";
    const target = typeof root === "object" ? root.$defs?.[name] : undefined;
    return target ? example(target, root, new Set([...seen, schema.$ref])) : "string";
  }
  const next = (/** @type {any} */ child) => example(child, root, seen);
  if (Array.isArray(schema.enum)) return schema.enum.join("|");
  if (schema.type === "boolean") return false;
  // 합집합은 가장 구조화된(마지막) 형식을 예시로 제시한다.
  const last = schema.anyOf?.at(-1);
  if (last !== undefined) return next(last);
  if (schema.type === "object")
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [key, next(value)]),
    );
  if (schema.type === "array" && schema.items && !Array.isArray(schema.items))
    return [next(schema.items)];
  return schema.description ?? "string";
}
// 문장 편집·교열(line·copy) 수정의 결과물: 원고를 다시 쓰지 않고 변경 표시(찾을 글 → 바꿀 글)만 낸다
// 코드가 find를 원고와 글자 그대로 대조해 적용하므로 표시하지 않은 곳은 바뀌지 않는다 · ADR-0018
export const draftEditSchema = z.looseObject({
  edits: z
    .array(
      z.looseObject({
        find: z
          .string()
          .min(1)
          .describe(
            "baseline에서 바꿀 부분을 글자 그대로 옮겨 적는다(본문에 한 번만 나오는 길이로).",
          ),
        replace: z.string().describe("그 자리에 들어갈 글을 적는다. 지울 때는 빈 문자열을 넣는다."),
      }),
    )
    .min(1),
  changeSummary: slot("무엇을 고쳤는지 1문장으로 적는다."),
});
export const draftEditExample = example(z.toJSONSchema(draftEditSchema));
export const stageOutputExamples = Object.fromEntries(
  Object.entries(stageOutputSchemas).map(([stage, schema]) => [
    stage,
    example(z.toJSONSchema(schema)),
  ]),
);
export const routeOutputExample = example(z.toJSONSchema(routeOutputSchema));
