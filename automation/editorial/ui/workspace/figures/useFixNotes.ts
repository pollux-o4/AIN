import { useMemo, useState } from "react";
import { FIGURE_FIX_PASS, revisionReady } from "../../../../contracts/figure.mjs";

// 그림마다 적은 고칠 의견 · 부분 고치기는 의견이 있는 그림 전부를 한 요청으로 모은다 · ADR-0026
// 요청 모양 검사는 요청 검사·상태 전이와 같은 규칙(revisionReady)을 쓴다
export function useFixNotes(ids: string[]) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const fix = useMemo(() => {
    const written = Object.fromEntries(
      ids.flatMap((id) => (notes[id]?.trim() ? [[id, notes[id]]] : [])),
    );
    const request = {
      target: FIGURE_FIX_PASS as "fix",
      figures: Object.keys(written),
      notes: written,
    };
    return revisionReady(request) ? request : null;
  }, [ids, notes]);
  return {
    note: (id: string) => notes[id] ?? "",
    setNote: (id: string, text: string) => setNotes((all) => ({ ...all, [id]: text })),
    fix,
  };
}
export type FixNotes = ReturnType<typeof useFixNotes>;
