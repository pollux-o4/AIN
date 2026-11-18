import type { RefObject } from "react";
import type { Run } from "../../shared/api";
import { FigurePlanNotes } from "./FigurePlanNotes";
import { FigureSlots } from "./FigureSlots";
import type { FigureChoiceState } from "./usePicked";

// 본문에 덧붙이는 시각자료 표시 · 고르는 중엔 후보 자리의 선택 단추(계획 펼침), 만든 뒤엔 그림 아래 접힌 계획
export function ArticleFigures({
  article,
  html,
  choice,
  figure,
}: {
  article: RefObject<HTMLElement | null>;
  html: string;
  choice: FigureChoiceState | null;
  figure: Run["figure"];
}) {
  if (choice) return <FigureSlots article={article} html={html} choice={choice} />;
  if (!figure?.candidates.length) return null;
  return (
    <FigurePlanNotes
      article={article}
      html={html}
      candidates={figure.candidates}
      motifs={figure.motifs}
    />
  );
}
