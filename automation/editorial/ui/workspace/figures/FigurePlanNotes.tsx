import { FigurePlan } from "./FigurePlan";
import { type Candidate, kindName, type Motif } from "./plan";

// 만든 그림 아래에 그 그림의 계획을 접어 둔다 · 결과가 왜 이렇게 나왔는지 필요할 때만 펼쳐 비교(FIGURE-001)
export function FigurePlanNote({
  candidate,
  candidates,
  motifs,
}: {
  candidate: Candidate;
  candidates: Candidate[];
  motifs: Motif[];
}) {
  const kind = kindName(candidate.kind);
  return (
    <details className="figure-plan-notes">
      <summary>이 그림의 계획{kind ? ` · ${kind}` : ""}</summary>
      <FigurePlan candidate={candidate} candidates={candidates} motifs={motifs} />
    </details>
  );
}
