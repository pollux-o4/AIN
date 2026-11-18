import { type Candidate, candidateNumber, type Motif } from "./plan";

// 같은 반복 대상을 그리는 다른 후보 번호 · 확인할 때 어디끼리 비교할지 알려 준다(ADR-0022)
function motifRows(candidate: Candidate, candidates: Candidate[], motifs: Motif[]) {
  return candidate.motifs.flatMap((name): [string, string][] => {
    const motif = motifs.find((item) => item.name === name);
    if (!motif) return [];
    const peers = candidates
      .filter((item) => item.id !== candidate.id && item.motifs.includes(name))
      .map((item) => candidateNumber(candidates, item.id));
    // 계약은 두 후보 이상만 남기지만(ADR-0022) 이전 데이터에선 짝이 없을 수 있다
    const shared = peers.length ? ` · 후보 ${peers.join("·")}에도 나옴` : "";
    return [["같은 대상", `${name}${shared} · ${motif.look}`]];
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
    // 사람이 덧붙인 방향 · 계획보다 먼저 따랐으므로 맨 위에서 결과와 비교(ADR-0023)
    ["내 방향", candidate.direction],
    // 고를 근거 · 답이 약하면 고르지 않는다(ADR-0025)
    ["없으면 놓치는 것", candidate.without],
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
