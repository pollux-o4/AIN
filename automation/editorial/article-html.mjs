import MarkdownIt from "markdown-it";
import cjkFriendly from "markdown-it-cjk-friendly";
import {
  FIGURE_MARKS,
  FIGURE_MOTION_ATTR,
  figureSrc,
  staticFigureSrc,
} from "../contracts/figure.mjs";
import { figureSpots, placeFigures } from "./domain/index.mjs";

const markdown = new MarkdownIt({ html: false, linkify: false })
  .use(cjkFriendly) // 한국어 조사 앞 `**…)**으로` 같은 강조도 닫히게(CommonMark 기본 규칙은 실패)
  .disable("image");
const text = (value) => markdown.utils.escapeHtml(String(value));

// 시각자료는 동일 출처 파일을 <img>로만 표시(스크립트 실행 없음) · 확인 전이면 그 사실을 함께 표시
function figureHtml(view, item) {
  const pending = view.figure.phase !== "confirmed";
  const src = figureSrc(view.id, item.id, view.version);
  return (
    `<figure class="figure" ${FIGURE_MARKS.figure}="${text(item.id)}"${pending ? ' data-pending=""' : ""}>` +
    `<img src="${text(staticFigureSrc(src))}" ${FIGURE_MOTION_ATTR}="${text(src)}" alt="${text(item.alt)}" loading="lazy">` +
    `<figcaption>${pending ? '<span class="figure-flag">확인 전</span>' : ""}${text(item.caption ?? item.claim)}</figcaption>` +
    "</figure>"
  );
}
// 본문은 그대로 렌더링하고 시각자료만 앵커 문단 뒤에 끼움 · 그림 표시 방식은 호출자가 정함 · FIGURE-001
export function renderArticle({ title, text: source, figures }, renderFigure) {
  const heading = `# ${title}\n`;
  const body = source.startsWith(heading) ? source.slice(heading.length) : source;
  return placeFigures(body, figures)
    .map((part) => (part.figure ? renderFigure(part.figure) : markdown.render(part.text)))
    .join("");
}
export const escapeHtml = text;
// 그림이 아직 없는 자리 · 화면이 상태(FIGURE_SPOTS)에 맞는 표시를 채운다
const slotHtml = (spot) =>
  `<div class="${FIGURE_MARKS.slotClass}" ${FIGURE_MARKS.candidate}="${text(spot.id)}" ${FIGURE_MARKS.spot}="${text(spot.spot)}"></div>`;
export function articleHtml(view) {
  const spots = figureSpots(view.figure, view.busy);
  return renderArticle({ ...view, figures: spots }, (spot) =>
    spot.item ? figureHtml(view, spot.item) : slotHtml(spot),
  );
}
