import { z } from "zod";
import { FIGURE_ID, FIGURE_LIMITS, FIGURE_ROUTES } from "./figure.mjs";
import { isAnimated } from "./svg-motion.mjs";

export { FIGURE_ROUTES };

// 유형별 기본 경로 · 경로 선택의 단일 원본 · 사람이 후보에 경로를 지정하면 그것을 따른다(FIGURE-002)
export const DEFAULT_ROUTE = Object.freeze(
  /** @type {Record<keyof typeof import("./figure.mjs").FIGURE_KINDS, (typeof FIGURE_ROUTES)[number]>} */ ({
    structure: "svg",
    flow: "svg",
    comparison: "svg",
    hierarchy: "svg",
    cycle: "svg",
    chart: "svg",
    table: "svg",
    scene: "image",
  }),
);
// 사람 지정 경로 → 유형 기본 경로 → svg · 선택·검증·화면 상태가 같은 규칙을 쓴다(FIGURE-002)
/** @param {{ kind?: string | null, route?: string | null }} candidate */
export const effectiveRoute = (candidate) =>
  candidate.route ??
  DEFAULT_ROUTE[/** @type {keyof typeof DEFAULT_ROUTE} */ (candidate.kind)] ??
  "svg";
// 파일 형식별 크기 상한·확장자 · 검사·파일 응답·내보내기가 같은 표를 쓴다
export const FIGURE_MIMES = Object.freeze({
  "image/svg+xml": { limit: FIGURE_LIMITS.svg, ext: "svg" },
  "image/png": { limit: 4_000_000, ext: "png" },
  "image/webp": { limit: 4_000_000, ext: "webp" },
});
const mime = z.enum(/** @type {[keyof typeof FIGURE_MIMES]} */ (Object.keys(FIGURE_MIMES)));
const line = (/** @type {number} */ max) => z.string().trim().min(1).max(max);

const figureLabelSchema = z.object({
  text: line(80),
  // 있으면 화면이 그림 위에 얹는다 · 그림 안에 그렸으면 비운다 · 0~1 비율 좌표
  anchor: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
});

// L1 그림 결과 · 화면·내려받기·내보내기가 읽는 유일한 형식(FIGURE-002)
export const figureResultSchema = z.object({
  id: z.string().regex(FIGURE_ID),
  route: z.enum(FIGURE_ROUTES),
  files: z
    .array(
      z.object({ path: z.string().regex(/^[\w.-]+$/), mime, bytes: z.number().int().positive() }),
    )
    .min(1)
    .refine((files) => files.every((f) => f.bytes <= FIGURE_MIMES[f.mime].limit), "File too large"),
  alt: line(FIGURE_LIMITS.alt),
  caption: line(FIGURE_LIMITS.caption).nullable(),
  motion: z.boolean(),
  labels: z.array(figureLabelSchema).max(30),
  // 이전 저장 결과는 실행 기록이 없어 null
  provenance: z
    .object({
      route: z.enum(FIGURE_ROUTES),
      adapter: z.string(),
      model: z.string().nullable(),
      ms: z.number().int().nonnegative(),
      tokens: z.number().int().nonnegative().nullable(),
      inputHash: z.string().regex(/^[0-9a-f]{64}$/),
      checks: z.number().int().nonnegative(),
    })
    .nullable(),
});

// L2 어댑터 능력 · 상위는 어댑터 이름이 아니라 이 값으로만 분기한다(FIGURE-002)
export const figureCapabilitiesSchema = z.object({
  motion: z.boolean(),
  textInImage: z.boolean(),
  partialEdit: z.boolean(),
  maxChecks: z.number().int().min(0).max(5),
});

// SVG에 선언형 움직임이 있는지 · 저장·생성이 같은 규칙을 쓴다

// 이전 저장 결과(svg 본문 하나) → svg 경로 결과로 읽기만 한다 · 다시 쓰지 않는다(FIGURE-002 호환)
/** @param {{ id: string, svg: string, alt: string, caption?: string | null }} item */
export function legacyFigureResult(item) {
  return {
    id: item.id,
    route: "svg",
    files: [
      {
        path: `${item.id}.svg`,
        mime: "image/svg+xml",
        bytes: new TextEncoder().encode(item.svg).length,
      },
    ],
    alt: item.alt,
    caption: item.caption ?? null,
    motion: isAnimated(item.svg),
    labels: [],
    provenance: null,
  };
}
