// 움직이는 SVG 판별과 정지판(움직임을 지운 기본 속성) · 내보내기·결과 표시·배치 점검이 함께 쓴다 · ADR-0011·ADR-0012
const SMIL = /<(animate|animateTransform|animateMotion|set)\b[^>]*?(\/>|>[\s\S]*?<\/\1\s*>)/gi;
const FREEZE = "<style>*{animation:none!important;transition:none!important}</style>";

/** @param {string} svg */
export const isAnimated = (svg) =>
  /<(animate|animateTransform|animateMotion|set)\b/i.test(svg) ||
  /@keyframes|animation\s*:/i.test(svg);

/** @param {string} svg */
export function staticSvg(svg) {
  if (!isAnimated(svg)) return svg;
  return svg.replace(SMIL, "").replace(/^<svg\b[^>]*>/, (open) => open + FREEZE);
}
