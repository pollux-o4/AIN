import { type Candidate, candidateNumber, type Motif } from "./plan";

// 같은 반복 대상을 그리는 다른 후보 번호 · 확인할 때 어디끼리 비교할지 알려 준다(ADR-0022)
function motifRows(candidate: Candidate, candidates: Candidate[], motifs: Motif[]) {
  return candidate.motifs.flatMap((name): [string, string][] => {
    const motif = motifs.find((item) => item.name === name);
    if (!motif) return [];
    const peers = candidates
      .filter((item) => item.id !== candidate.id && item.motifs.includes(name))
      .map((item) => candidateNumber(candidates, item.id));
    return [["같은 대상", `${name} · 후보 ${peers.join("·")}에도 나옴 · ${motif.look}`]];
  });
}

// 위치 제안이 세운 그림 계획 · 고르기 전에 무엇을 어떤 구도로 그릴지 가늠하게(FIGURE-001)
export function FigurePlan({
  candidate,
  candidates,
  motifs,
}: {
  candidate: Candidate;
  candidates: Candidate[];
  motifs: Motif[];
}) {
  const plan: [string, string | null][] = [
    ["구도", candidate.scene],
    ["비유", candidate.analogy],
    ["이 자리에서", candidate.reason],
  ];
  const rows = plan
    .filter((row): row is [string, string] => Boolean(row[1]))
    .concat(motifRows(candidate, candidates, motifs));
  return (
    <span className="figure-plan">
      <strong>{candidate.claim}</strong>
      {rows.length > 0 && (
        <span className="figure-plan-rows">
          {rows.map(([name, value]) => (
            <span key={`${name}:${value}`}>
              <b>{name}</b> {value}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
