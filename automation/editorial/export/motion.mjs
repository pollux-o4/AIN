// 움직이는 SVG의 정지판: 애니메이션을 지우는 곳(RSS·메일·인쇄)용 · 기본 속성 = 첫 프레임 · ADR-0011
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
