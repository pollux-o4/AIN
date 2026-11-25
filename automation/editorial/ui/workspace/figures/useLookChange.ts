import { useMemo, useState } from "react";
import { type Candidate, type LookId, motifPeers } from "./plan";

// 그림체 바꾸기 상태 · 고른 자리와, 함께 바꿀 경우 같은 대상이 나오는 자리까지 대상으로 묶는다(ADR-0022·0027)
// 되돌리기(그림 한 장)와 구성 확인(여러 자리)이 같은 규칙을 쓴다
export function useLookChange(candidates: Candidate[], ids: readonly string[]) {
  const [look, setLook] = useState<LookId | "">("");
  const [withPeers, setWithPeers] = useState(true);
  const peers = useMemo(() => motifPeers(candidates, ids), [candidates, ids]);
  const looks = new Set(
    ids.map((id) => candidates.find((candidate) => candidate.id === id)?.look ?? null),
  );
  return {
    look,
    setLook,
    withPeers,
    setWithPeers,
    peers,
    // 고른 자리들의 그림체가 하나로 같을 때만 지금 그림체로 보인다
    current: looks.size === 1 ? [...looks][0] : null,
    targets: look && withPeers ? [...ids, ...peers.ids] : [...ids],
  };
}
export type LookChange = ReturnType<typeof useLookChange>;
