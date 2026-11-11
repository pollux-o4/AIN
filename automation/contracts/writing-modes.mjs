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
});
export const DEFAULT_DIRECTION = Object.freeze({ mode: AUTO, readerLevel: AUTO });

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
