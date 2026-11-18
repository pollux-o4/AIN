import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { marks } from "./articleMarks";
import { FigurePlan } from "./FigurePlan";
import { kindName } from "./plan";
import { useArticleTargets } from "./useArticleTargets";
import type { FigureChoiceState } from "./usePicked";

// 만든 그림 아래에 그 그림의 계획을 접어 둔다 · 결과가 왜 이렇게 나왔는지 필요할 때만 펼쳐 비교(FIGURE-001)
export function FigurePlanNotes({
  article,
  html,
  candidates,
  motifs,
}: {
  article: RefObject<HTMLElement | null>;
  html: string;
  candidates: FigureChoiceState["candidates"];
  motifs: FigureChoiceState["motifs"];
}) {
  const figures = useArticleTargets(article, html, marks.figure);
  return figures.map((figure) => {
    const id = marks.figureOf(figure);
    const candidate = candidates.find((item) => item.id === id);
    if (!candidate) return null;
    const kind = kindName(candidate.kind);
    return createPortal(
      <details className="figure-plan-notes">
        <summary>이 그림의 계획{kind ? ` · ${kind}` : ""}</summary>
        <FigurePlan candidate={candidate} candidates={candidates} motifs={motifs} />
      </details>,
      figure,
      id,
    );
  });
}
