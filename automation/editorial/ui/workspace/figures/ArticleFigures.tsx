import type { RefObject } from "react";
import type { Run } from "../../shared/api";
import { marks } from "./articleMarks";
import { FigurePlanNote } from "./FigurePlanNotes";
import { ChoiceSlot, StatusSlot } from "./FigureSlots";
import { MarkPortals } from "./MarkPortals";
import type { FigureChoiceState } from "./usePicked";

// 본문에 덧붙이는 시각자료 표시 · 자리 상태는 서버가 정하고(FIGURE_SPOTS) 여기서는 상태별 표시만 고른다
// 후보 고르기 → 고른 자리(구성·생성 상태) → 만든 그림 아래 접힌 계획, 모두 같은 자리에서 이어진다
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
  const candidates = figure?.candidates ?? [];
  if (!candidates.length) return null;
  const motifs = figure?.motifs ?? [];
  // 자리마다 후보·번호를 다시 훑지 않게 한 번 색인
  const byId = new Map(
    candidates.map((candidate, index) => [candidate.id, { candidate, number: index + 1 }]),
  );
  const shared = { article, html };
  return (
    <>
      <MarkPortals
        {...shared}
        selector={marks.slot}
        idOf={marks.candidateOf}
        render={(id, slot) => {
          const found = byId.get(id);
          if (!found) return null;
          const { candidate, number } = found;
          const spot = marks.spotOf(slot);
          if (spot === "candidate" && choice)
            return <ChoiceSlot candidate={candidate} choice={choice} />;
          return (
            <StatusSlot
              candidate={candidate}
              spot={spot}
              error={figure?.failed[id]}
              number={number}
              candidates={candidates}
              motifs={motifs}
            />
          );
        }}
      />
      <MarkPortals
        {...shared}
        selector={marks.figure}
        idOf={marks.figureOf}
        render={(id) => {
          const candidate = byId.get(id)?.candidate;
          return candidate ? (
            <FigurePlanNote candidate={candidate} candidates={candidates} motifs={motifs} />
          ) : null;
        }}
      />
    </>
  );
}
