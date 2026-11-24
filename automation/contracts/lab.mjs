// 시각자료 연구소 기록 계약 · 같은 사례를 변형(현재·A·B…)마다 돌린 결과를 한 형식으로 남겨 나란히 비교한다(LAB-001)
// 기록 쓰기는 paseo/lab, 보기는 editorial/ui/lab이 맡고 둘 다 이 계약만 읽는다
import { z } from "zod";

const LAB_BASELINE = "baseline";
// 위치 선정·구성·생성 · 대상 정책은 구성 단계 변수 · ADR-0026
const LAB_STAGES = /** @type {const} */ (["plan", "compose", "figure"]);
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

const labVariantSchema = z.object({
  id: slug,
  label: z.string().min(1).max(40),
  hypothesis: z.string().max(300),
  changes: z.array(z.string().max(200)).max(10),
});

const labCandidateSchema = z.object({
  id: z.string().max(4).optional(),
  anchor: z.string().max(30),
  analogy: z.string().max(80).optional(),
  scene: z.string().max(500).optional(),
  relation: z.string().max(40).optional(),
  without: z.string().max(200).optional(),
  mapping: z
    .array(z.object({ element: z.string(), concept: z.string() }))
    .max(12)
    .optional(),
});

export const labRecordSchema = z.object({
  case: slug,
  variant: slug,
  trial: z.number().int().min(1),
  stage: z.enum(LAB_STAGES),
  at: z.string().datetime(),
  ref: z.string().max(80).nullable(), // 실행한 코드 기준(커밋·변경 해시) · 재현 근거
  model: z.string().max(80).nullable(),
  ms: z.number().int().nonnegative().nullable(),
  tokens: z.object({ input: z.number().int(), output: z.number().int() }).nullable(),
  candidates: z.array(labCandidateSchema).max(30).optional(),
  world: z.string().max(300).optional(),
  files: z.array(z.object({ path: z.string().regex(/^[\w.-]+$/), mime: z.string() })).max(8),
  // 시각 확인 집계 · 렌더 명령, 렌더 이미지 열람, 열람 뒤 수정 횟수 · 도구 기록이 없으면 null
  visual: z
    .object({
      renders: z.number().int(),
      views: z.number().int(),
      editsAfterView: z.number().int(),
    })
    .nullable(),
  // 판정은 사람·검토가 한다(JUDGE-001) · 코드는 집계만
  verdict: z
    .object({ by: z.string().max(40), pass: z.boolean(), note: z.string().max(400) })
    .nullable(),
  note: z.string().max(400).optional(),
});

export const labSchema = z.object({
  variants: z.array(labVariantSchema),
  records: z.array(labRecordSchema),
});

/** @param {number[]} values */
const median = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

// 사례 × 변형 비교표 · 기준 변형을 첫 열에 두고, 칸마다 회차와 세기 요약을 붙인다
/** @param {z.infer<typeof labSchema>} lab */
export function labMatrix(lab) {
  const known = new Set(lab.variants.map((v) => v.id));
  const extra = [...new Set(lab.records.map((r) => r.variant))].filter((id) => !known.has(id));
  const variants = [
    ...lab.variants,
    ...extra.map((id) => ({ id, label: id, hypothesis: "", changes: [] })),
  ].sort((a, b) => Number(b.id === LAB_BASELINE) - Number(a.id === LAB_BASELINE));
  const cases = [...new Set(lab.records.map((r) => r.case))].sort();
  const rows = cases.map((id) => ({
    case: id,
    cells: variants.map((variant) => {
      const records = lab.records
        .filter((r) => r.case === id && r.variant === variant.id)
        .sort((a, b) => a.stage.localeCompare(b.stage) || a.trial - b.trial);
      const judged = records.filter((r) => r.verdict);
      const tokens = records.flatMap((r) => (r.tokens ? [r.tokens.input + r.tokens.output] : []));
      return {
        variant: variant.id,
        records,
        summary: {
          trials: records.length,
          ms: median(records.flatMap((r) => (r.ms === null ? [] : [r.ms]))),
          tokens: median(tokens),
          passed: judged.filter((r) => r.verdict?.pass).length,
          judged: judged.length,
        },
      };
    }),
  }));
  return { variants, rows };
}
