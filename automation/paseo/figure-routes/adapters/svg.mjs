import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isAnimated } from "../../../contracts/svg-motion.mjs";
import { xmlSafeSvg } from "../../../contracts/svg-xml.mjs";

const FILE = "figure.svg";

// svg 경로 · 그리는 법(ADR-0024 단계 또는 현행 AI 생성)은 draw 포트가 맡고, 어댑터는 계약 변환만 한다
/**
 * @param {{
 *   id: string,
 *   version: string,
 *   draw: (input: import("../types.mjs").RouteInput, ctx: import("../types.mjs").RouteContext) => Promise<{
 *     svg: string, alt: string, caption: string | null, model: string | null, tokens: number | null, checks: number,
 *   }>,
 *   maxChecks?: number,
 * }} options
 * @returns {import("../types.mjs").RouteAdapter}
 */
export function svgAdapter({ id, version, draw, maxChecks = 2 }) {
  return {
    id,
    route: "svg",
    version,
    // SVG 글자는 그림 안 글자이며 정확하다 · 움직임은 CSS·SMIL 선언형
    capabilities: { motion: true, textInImage: true, partialEdit: true, maxChecks },
    async render(input, ctx) {
      const drawn = await draw(input, ctx);
      const made = { ...drawn, svg: xmlSafeSvg(drawn.svg) };
      await writeFile(join(ctx.dir, FILE), made.svg, { mode: 0o600 });
      return {
        files: [{ path: FILE, mime: "image/svg+xml" }],
        alt: made.alt,
        caption: made.caption,
        motion: isAnimated(made.svg),
        // SVG 본문에 글자 그대로 있는 라벨만 결과로 · 빠지면 실행기가 실패로 본다
        labels: input.labels
          .filter(({ text }) => made.svg.includes(text))
          .map(({ text }) => ({ text })),
        model: made.model,
        tokens: made.tokens,
        checks: made.checks,
      };
    },
  };
}
