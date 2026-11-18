import { z } from "zod";

// 시각자료(figure): 확정된 초안의 앵커 문장 뒤에 배치만 하고 본문은 바꾸지 않음 · FIGURE-001
export const FIGURE_LIMITS = Object.freeze({
  // 시각화할 수 있는 곳은 모두 제안 · 사람이 고른다 · 이 값은 한 글의 안전 상한(FIGURE_ID 범위 안) · ADR-0017
  candidates: 30,
  // 그림 한 장의 한 층 · 생성(/anatomy Figure)은 도구로 만들고 검사해 일반 단계(5분)보다 길다 · ADR-0011
  generateMs: 3600000,
  skipReason: 200,
  anchor: 400,
  claim: 300,
  // 그림 담당이 글 맥락을 이어받는 인계 · 위치 제안이 판단한 이유·비유·장면
  reason: 500,
  scene: 500,
  // anatomy Figure(부품 40~80개)는 100~200KB · 모델은 파일로 내고 어댑터가 읽는다(svgFile)
  svg: 400000,
  alt: 300,
  caption: 200,
  notes: 600,
});
// 코드가 부여하는 시각자료 id · 화면 주소·작업 파일 이름·선택 검사가 같은 규칙을 쓴다
export const FIGURE_ID = /^f[1-9]\d?$/;
const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';
const text = (/** @type {number} */ max) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, "Nonempty text required");
/** @template {z.ZodType} T @param {T} schema */
const advisory = (schema) => schema.optional().catch(undefined);

// AI가 만든 SVG는 신뢰하지 않음: 실행·외부 참조가 가능한 요소·속성 거부 · 화면은 <img>로만 표시
/** @type {readonly (readonly [RegExp, string])[]} */
const FORBIDDEN = [
  [/<\s*(script|foreignObject|iframe|object|embed|image|a)\b/i, "금지된 요소"],
  // SMIL 움직임은 허용하되 주소·이벤트 속성을 바꾸는 애니메이션은 거부(img 밖 인라인 삽입 대비)
  [/attributeName\s*=\s*["']?\s*(xlink:)?(href|src|on[a-z]+)\b/i, "금지된 애니메이션 대상"],
  [/<!(DOCTYPE|ENTITY)/i, "문서 선언"],
  [/\son[a-z]+\s*=/i, "이벤트 속성"],
  [/javascript:/i, "스크립트 주소"],
  [/(href|src)\s*=\s*["']?(?!["']?#)/i, "외부 참조"],
  [/url\(\s*["']?(?!#)/i, "외부 참조"],
  [/@import/i, "외부 참조"],
];
/** @param {string} svg @returns {string | null} 거부 사유 */
export function svgIssue(svg) {
  const value = svg.trim();
  if (!/^<svg[\s>]/.test(value) || !value.endsWith("</svg>")) return "svg 요소 하나여야 함";
  return FORBIDDEN.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}
// <img>로 그리려면 네임스페이스가 필요 · 빠졌으면 보충(내용은 그대로)
const svg = z
  .string()
  .max(FIGURE_LIMITS.svg)
  .refine((value) => svgIssue(value) === null, "Unsafe or malformed SVG")
  .transform((value) => {
    const trimmed = value.trim();
    return /^<svg[^>]*\sxmlns=/.test(trimmed)
      ? trimmed
      : trimmed.replace(/^<svg/, `<svg ${SVG_NS}`);
  });

export const FIGURE_STAGES = /** @type {const} */ (["figure_plan", "figure"]);
// 생성은 층을 나눈 세 번의 AI 작업: 초안(구도) → 내용(비유·인과 정확성) → 시각(마감·움직임) · ADR-0011
export const FIGURE_PASSES = /** @type {const} */ (["draft", "content", "visual"]);
export const figureOutputSchemas = {
  // 위치 후보: anchor는 초안 문장 그대로(도메인이 대조), claim은 시각자료가 보여줄 주장
  figure_plan: z.looseObject({
    candidates: z
      .array(
        z.looseObject({
          anchor: text(FIGURE_LIMITS.anchor),
          claim: text(FIGURE_LIMITS.claim),
          reason: text(FIGURE_LIMITS.reason),
          analogy: advisory(z.string().max(100)),
          scene: text(FIGURE_LIMITS.scene),
          kind: advisory(z.string().max(40)),
        }),
      )
      .min(1),
    // 후보를 두지 않은 단위와 그 이유 · 코드가 단위 목록과 글자 그대로 대조해 빠진 단위를 센다
    skipped: advisory(
      z.array(z.looseObject({ unit: z.string().max(200), reason: text(FIGURE_LIMITS.skipReason) })),
    ),
  }),
  figure: z.looseObject({
    figures: z
      .array(
        z.looseObject({
          id: z.string().max(20),
          svg,
          alt: text(FIGURE_LIMITS.alt),
          caption: advisory(text(FIGURE_LIMITS.caption)),
          // 다음 층에 넘기는 작업 메모(바꾼 것·남은 문제) · 최종 결과에는 저장하지 않음
          notes: advisory(z.string().max(FIGURE_LIMITS.notes)),
        }),
      )
      .min(1),
  }),
};
export const figureOutputExamples = {
  figure_plan: {
    candidates: [
      {
        anchor: "초안의 해당 문장을 글자 그대로 기재한다.",
        claim: "string",
        reason: "글의 흐름에서 이 지점이 맡는 역할과 독자가 여기서 이해해야 할 핵심을 기재한다.",
        analogy: "본문에서 사용한 비유 대상을 기재하며, 없으면 생략한다.",
        scene: "그 핵심을 보여 줄 원인 → 결과 장면을 기재한다.",
        kind: "structure|flow|comparison|hierarchy|cycle|chart|table|scene",
      },
    ],
    skipped: [{ unit: "units의 항목을 글자 그대로 기재한다.", reason: "string" }],
  },
  figure: {
    figures: [
      {
        id: "f1",
        svgFile: "/작업 폴더/f1.svg",
        alt: "string",
        caption: "string",
        notes: "이번 층에서 변경한 사항과 다음 층에서 검토해야 할 남은 과제를 기재한다.",
      },
    ],
  },
};
// 사람이 고른 후보·남길 시각자료 id · 코드가 부여한 FIGURE_ID
export const figureIdsSchema = z
  .array(z.string().regex(FIGURE_ID))
  .min(1)
  .max(FIGURE_LIMITS.candidates)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate figure id");
