import { z } from "zod";

// 글 방향 SSoT: 서술 방식(mode)·독자 수준 값과 표시 이름. 규칙 본문은 paseo/seasoning이 소유.
export const AUTO = "auto";
export const WRITING_MODES = /** @type {const} */ (["explain", "procedure", "argue", "narrate"]);
export const READER_LEVELS = /** @type {const} */ (["beginner", "intermediate", "expert"]);

export const modeLabels = Object.freeze({
  explain: "설명",
  procedure: "따라 하기",
  argue: "주장",
  narrate: "이야기",
});
export const modeHints = Object.freeze({
  explain: "개념을 이해시키는 글",
  procedure: "순서대로 해 보게 하는 글",
  argue: "근거로 설득하는 글",
  narrate: "경험·사례를 들려주는 글",
});
export const levelLabels = Object.freeze({
  beginner: "입문",
  intermediate: "중급",
  expert: "숙련",
});

export const writingModeSchema = z.enum(WRITING_MODES);
export const readerLevelSchema = z.enum(READER_LEVELS);
export const directionSchema = z.object({
  mode: z.enum([AUTO, ...WRITING_MODES]).default(AUTO),
  readerLevel: z.enum([AUTO, ...READER_LEVELS]).default(AUTO),
  // 목표 분량(공백 포함 문자 수) · 없으면 글감·피드백 문장에서 읽음 · ADR-0007
  targetLength: z
    .object({ min: z.number().int().min(0), max: z.number().int().positive() })
    .refine((v) => v.min <= v.max, "min <= max")
    .optional(),
});
export const DEFAULT_DIRECTION = Object.freeze({ mode: AUTO, readerLevel: AUTO });

// 목표 분량 SSoT · 화면 프리셋과 CLI `--length`가 같은 규칙(±10%) 사용 · ADR-0007
const LENGTH_TOLERANCE = 0.1;
export const lengthRange = (/** @type {number} */ target) => ({
  min: Math.round(target * (1 - LENGTH_TOLERANCE)),
  max: Math.round(target * (1 + LENGTH_TOLERANCE)),
});
export const LENGTH_PRESETS = Object.freeze([
  { value: "short", label: "짧게", target: 2000, hint: "약 2,000자 · 한 가지 핵심" },
  { value: "medium", label: "보통", target: 4500, hint: "약 4,500자 · 핵심 3~5구간" },
  { value: "long", label: "길게", target: 8000, hint: "약 8,000자 · 깊이 있는 해설" },
]);

/** @typedef {z.infer<typeof writingModeSchema>} WritingMode */
/** @typedef {z.infer<typeof readerLevelSchema>} ReaderLevel */
/** @typedef {z.infer<typeof directionSchema>} Direction */

/** outline 구간은 이전 문자열 형식과 구간 카드 형식을 모두 허용한다. */
export const sectionTitle = (/** @type {unknown} */ section) =>
  typeof section === "string"
    ? section
    : section && typeof section === "object" && "title" in section
      ? String(section.title)
      : "";
export const sectionMode = (/** @type {unknown} */ section) => {
  if (!section || typeof section !== "object" || !("mode" in section)) return null;
  const parsed = writingModeSchema.safeParse(section.mode);
  return parsed.success ? parsed.data : null;
};

// 구간 카드(RES-007 S3·S6·S7·S8): 따라 하기 구간은 한 단계 한 행동이 틀이라 제외 · ADR-0013
export const STORY_SLOTS = /** @type {const} */ (["hook", "cases", "principleLine", "underline"]);
export const MAX_CASES = 3;
export const usesStoryCard = (/** @type {unknown} */ mode) =>
  writingModeSchema.safeParse(mode).success && mode !== "procedure";
// 카드를 문장으로 옮길 최소 지면(공백 포함 글자 수) · 이보다 작으면 항목을 낱말로 줄여 글이 깨진다(실제 모델 실측: 250자 구간)
// section: hook·사례 1개·원칙·강조 문장·마무리 문장 / intro: 제목·약속·장면·순서 안내(첫 구간에 더함) / summaryLine: 끝 정리 목록 한 줄(마지막 구간에 구간 수만큼 더함)
// shortcut: 어림값(항목별 한 문장 40~60자 가정), 실제 글 표본으로 구간 길이 분포를 재면 조정
export const CARD_SPACE = Object.freeze({ section: 260, intro: 160, summaryLine: 30 });
// 사례 출처: 자료에 있는 것 | 지어낸 것(본문에서 '가상의 예'로 표시)
export const CASE_ORIGINS = /** @type {const} */ (["source", "hypothetical"]);

/** 화면에 보이는 글 설계 투영. 편집 서비스 view가 만들고 UI가 그대로 표시한다. */
const chosenBy = z.enum(["user", "ai"]).nullable();
export const designViewSchema = z.object({
  mode: writingModeSchema.nullable(),
  modeBy: chosenBy,
  readerLevel: readerLevelSchema.nullable(),
  levelBy: chosenBy,
  sections: z.array(z.object({ title: z.string(), mode: writingModeSchema.nullable() })),
});
/** @typedef {z.infer<typeof designViewSchema>} DesignView */
