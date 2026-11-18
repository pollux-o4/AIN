import { FIGURE_MARKS } from "../../../../contracts/figure.mjs";

// 본문 HTML 속 시각자료 표시를 찾는 선택자 · 이름은 서버와 같은 계약(FIGURE_MARKS)에서
export const marks = {
  slot: `.${FIGURE_MARKS.slotClass}`,
  figure: `figure[${FIGURE_MARKS.figure}]`,
  candidateOf: (slot: HTMLElement) => slot.getAttribute(FIGURE_MARKS.candidate) ?? "",
  figureOf: (figure: HTMLElement) => figure.getAttribute(FIGURE_MARKS.figure) ?? "",
};

// 본문 속 시각자료·후보 자리로 이동 · 그림이 있으면 그림, 고르는 중이면 후보 자리
export function locateFigure(id: string) {
  const value = CSS.escape(id);
  document
    .querySelector(
      `#article :is([${FIGURE_MARKS.figure}="${value}"], [${FIGURE_MARKS.candidate}="${value}"])`,
    )
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}
