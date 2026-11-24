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
  // 그릴 대상의 이름 · 어디서 가져올지는 대상 정책(LAB-001)이 정한다 · 구체 모습은 scene
  analogy: 80,
  // 확인 단계 국소 수정 횟수 상한(그림 한 장) · 넘으면 다시 구성으로 · ADR-0026
  fixes: 3,
  // 그림 사이 일관성 계약 · 공통 시각 규칙 한 항목과 반복 대상 이름·생김새 · ADR-0022
  style: 200,
  motifs: 12,
  motifName: 40,
  motifLook: 300,
  // 사람이 후보마다 덧붙이는 그림 방향 · 한두 줄 · ADR-0023
  direction: 300,
  // 구성 단계가 글 전체에 까는 장면 세계 한 줄 · 사람이 구성 검수에서 남기는 의견 · ADR-0026
  world: 300,
  feedback: 600,
  // 이 그림이 없으면 독자가 놓치는 것 · 사람이 고를 근거 · ADR-0025
  without: 200,
  // 그림 요소 → 본문 개념 대응표 · 개념 사이 관계·깨지는 경우도 한 줄씩 옮긴다 · 파일럿 판정 근거(RES-011)
  mapping: 12,
  mappingText: 80,
  // 그림 속 글자 요소 예산 · 글자가 많으면 그림이 읽히지 않고 생성·점검 시간도 는다(LAB-001 looks2: 29~72개) · 배치 점검 도구가 센다
  texts: 10,
  // anatomy Figure(부품 40~80개)는 100~200KB · 모델은 파일로 내고 어댑터가 읽는다(svgFile)
  svg: 400000,
  // 그림을 만든 원본(빌드 스크립트 등) · 다음 층·수정이 SVG 대신 이것을 고쳐 다시 만든다 · 형식은 모르는 채 글자로만 보관
  source: 200000,
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

// 시각화 유형: 이름과 그 유형이 드러내는 관계 · 위치 제안 지시문과 화면 표시가 같은 목록을 쓴다
export const FIGURE_KINDS = Object.freeze({
  structure: { name: "구성", shows: "구성 요소와 그 배치" },
  flow: { name: "흐름", shows: "순서·절차·흐름" },
  comparison: { name: "비교", shows: "둘 이상의 대비" },
  hierarchy: { name: "분류", shows: "분류·포함 관계" },
  cycle: { name: "순환", shows: "반복되는 순환" },
  chart: { name: "수량", shows: "수량·변화" },
  table: { name: "표", shows: "여러 기준의 대조" },
  scene: { name: "장면", shows: "비유 장면" },
});
// 본문 HTML 속 시각자료 표시 · 서버가 붙이고 화면이 찾는다(같은 이름을 양쪽에 따로 적지 않는다)
export const FIGURE_MARKS = Object.freeze({
  figure: "data-figure",
  candidate: "data-candidate",
  slotClass: "figure-slot",
});
// 공통 시각 규칙 항목 · 계약 검사·저장·화면이 같은 목록을 쓴다 · ADR-0022
export const FIGURE_STYLE_KEYS = /** @type {const} */ (["accent", "base", "labels"]);
// 그림 스타일 · 글 하나에 하나를 구성이 고른다 · 그리기 규칙은 paseo/prompts/looks.mjs · ADR-0027
export const FIGURE_LOOKS = Object.freeze({
  anatomy: { fits: "실물 비유의 입체 아이소메트릭 그림" },
  sketchnote: { fits: "개념 정리·단계·요약, 점 격자 종이의 펜과 마커 노트" },
  tablet: { fits: "대상과 그 상태 변화, 연필 선 아래 어긋난 색 덩어리" },
  stick: { fits: "사람 사이의 연결·전파·관계, 막대 인물과 강조색 하나" },
  manual: { fits: "절차·조립·사용법·해도 됨과 안 됨, 아이소메트릭 설명서" },
});
export const figureLookSchema = z.enum(Object.keys(FIGURE_LOOKS));
// 위치 선정 → (사람 선택) → 구성 → (사람 승인) → 생성 · ADR-0026
export const FIGURE_STAGES = /** @type {const} */ (["figure_plan", "figure_compose", "figure"]);
// 생성은 두 층: 초안(구도·내용 자기 판정) → 시각(마감·움직임) · 무엇을 그릴지는 구성이 정하므로 내용 층을 초안에 합침 · ADR-0011·ADR-0026
// 그리기 한 층 · 초안·시각 두 층은 같은 세션의 인계만 늘려 합침(RES-011)
export const FIGURE_PASSES = /** @type {const} */ (["draw"]);
// 확인 뒤 지적만 고치는 층 · 직전 그림과 의견을 받아 국소 수정 · ADR-0026
export const FIGURE_FIX_PASS = "fix";
export const figureOutputSchemas = {
  // 위치 후보: anchor는 초안 문장 그대로(도메인이 대조), claim은 시각자료가 보여줄 주장
  // 위치 후보: 자리와 보여 줄 관계만 · 장면·비유·일관성 계약은 구성 단계가 정한다 · ADR-0026
  figure_plan: z.looseObject({
    candidates: z
      .array(
        z.looseObject({
          anchor: text(FIGURE_LIMITS.anchor),
          claim: text(FIGURE_LIMITS.claim),
          reason: text(FIGURE_LIMITS.reason),
          without: advisory(text(FIGURE_LIMITS.without)),
          kind: advisory(z.string().max(40)),
        }),
      )
      .min(1),
    // 후보를 두지 않은 단위와 그 이유 · 코드가 단위 목록과 글자 그대로 대조해 빠진 단위를 센다
    skipped: advisory(
      z.array(z.looseObject({ unit: z.string().max(200), reason: text(FIGURE_LIMITS.skipReason) })),
    ),
  }),
  // 구성: 고른 자리 전부를 한 번에 · 장면 세계 하나와 자리별 장면·대응표·일관성 계약 · ADR-0026
  figure_compose: z.looseObject({
    world: advisory(text(FIGURE_LIMITS.world)),
    designs: z
      .array(
        z.looseObject({
          id: z.string().regex(FIGURE_ID),
          analogy: advisory(text(FIGURE_LIMITS.analogy)),
          scene: text(FIGURE_LIMITS.scene),
          mapping: advisory(
            z
              .array(
                z.looseObject({
                  element: text(FIGURE_LIMITS.mappingText),
                  concept: text(FIGURE_LIMITS.mappingText),
                }),
              )
              .max(FIGURE_LIMITS.mapping),
          ),
          // 이 그림에 나오는 반복 대상 이름 · motifs의 name과 글자 그대로 같아야 이어진다
          motifs: advisory(z.array(z.string().max(FIGURE_LIMITS.motifName))),
        }),
      )
      .min(1),
    // 그림 사이 일관성 계약 · 그림은 한 장씩 따로 만들므로 같은 규칙·생김새를 미리 정해 넘긴다 · ADR-0022
    style: advisory(
      z
        .looseObject(
          Object.fromEntries(FIGURE_STYLE_KEYS.map((key) => [key, text(FIGURE_LIMITS.style)])),
        )
        .extend({
          // 모르는 스타일은 버려 기본값(anatomy)으로 그린다 · ADR-0027
          look: advisory(figureLookSchema),
        }),
    ),
    motifs: advisory(
      z.array(
        z.looseObject({
          name: text(FIGURE_LIMITS.motifName),
          look: text(FIGURE_LIMITS.motifLook),
        }),
      ),
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
          // 메모는 다음 층 인계이므로 넘쳐도 버리지 않고 앞부분을 남김
          notes: advisory(z.string().transform((text) => text.slice(0, FIGURE_LIMITS.notes))),
          source: advisory(z.string().max(FIGURE_LIMITS.source)),
        }),
      )
      .min(1),
  }),
};
export const figureOutputExamples = {
  figure_plan: {
    candidates: [
      {
        anchor: "초안의 해당 문장을 글자 그대로 적는다.",
        claim: "그림이 보여 줄 대상과 그 관계를 1문장으로 적는다.",
        reason: "글의 흐름에서 이 지점이 맡는 역할과 독자가 여기서 이해해야 할 핵심을 적는다.",
        without: "이 그림을 지우면 독자가 앵커 문장만으로 알아내기 어려운 관계를 1문장으로 적는다.",
        kind: Object.keys(FIGURE_KINDS).join("|"),
      },
    ],
    skipped: [
      {
        unit: "units에 있는 항목을 글자 그대로 적는다.",
        reason: "그림이 도움이 되지 않는 이유를 1문장으로 적는다.",
      },
    ],
  },
  figure_compose: {
    world: "모든 그림이 함께 놓일 장면 세계를 1문장으로 적는다.",
    designs: [
      {
        id: "f1",
        analogy: "그릴 대상의 이름을 짧게 적고, 없으면 생략한다.",
        scene: "그 핵심을 보여 줄 원인 → 결과 장면을 적는다.",
        mapping: [
          {
            element: "그림 속 사물·행동·상태 하나, 또는 그 사이의 관계",
            concept: "그것이 뜻하는 본문 개념, 또는 개념 사이의 관계·깨지는 경우",
          },
        ],
        motifs: ["이 그림에 나오는 반복 대상의 name을 적고, 없으면 생략한다."],
      },
    ],
    style: {
      look: "글 전체에 쓸 그림 스타일 id 하나를 적는다.",
      accent: "원인 → 결과 경로에만 쓸 강조색 하나를 색 이름과 hex로 적는다.",
      base: "모든 그림이 함께 쓸 바탕색·선 색·보조색과 선 굵기를 적는다.",
      labels: "라벨 글자 크기·굵기·배치 방식을 적는다.",
    },
    motifs: [
      {
        name: "두 그림 이상에 나오는 대상의 이름을 짧게 적는다.",
        look: "모든 그림에서 같은 모습으로 그릴 수 있도록 형태·부품·색을 구체적으로 적는다.",
      },
    ],
  },
  figure: {
    figures: [
      {
        id: "f1",
        svgFile: "/작업 폴더/f1.svg",
        sourceFile: "/작업 폴더/f1.source.mjs (SVG를 만든 원본이 있으면 · 없으면 생략)",
        alt: "그림을 볼 수 없는 독자를 위한 대체 설명 1~2문장을 적는다.",
        caption: "그림 아래에 놓을 한 줄 설명을 적는다.",
        notes: "이번 층에서 바꾼 사항과 다음 층에서 살필 남은 과제를 적는다.",
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
// 후보별 사람 방향 · 고른 후보에만 저장한다 · 빈 값은 방향 없음 · ADR-0023
export const figureDirectionsSchema = z
  .record(z.string().regex(FIGURE_ID), z.string().max(FIGURE_LIMITS.direction))
  .refine((map) => Object.keys(map).length <= FIGURE_LIMITS.candidates, "Too many directions");
// 그림 경로 · 산출 형식 단위 · ADR-0025
export const FIGURE_ROUTES = /** @type {const} */ (["image", "svg"]);
// 후보별 사람 지정 경로 · 고른 후보에만 저장한다 · 비우면 유형 기본 경로 · ADR-0025
export const figureRoutesSchema = z
  .record(z.string().regex(FIGURE_ID), z.enum(FIGURE_ROUTES))
  .refine((map) => Object.keys(map).length <= FIGURE_LIMITS.candidates, "Too many routes");
// 피드백을 보낼 곳: 무엇을 그릴지(compose, 다시 구성) · 어떻게 그렸는지(fix, 국소 수정) · ADR-0026
export const FIGURE_REVISE_TARGETS = /** @type {const} */ (["compose", "fix"]);
// 사람이 구성·그림에 남기는 의견 · ADR-0026
export const figureFeedbackSchema = text(FIGURE_LIMITS.feedback);
