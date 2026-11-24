// 그림 묶음 판정 · 장마다 끝난 상태만 보고 묶음이 무엇을 할지 정한다(저장·잠금은 호출자) · ADR-0026
// 장마다 자기 자리 그림만 받는다: 자기 그림이 없으면 그 장만 실패로 보아 다른 장 결과를 막지 않는다
// 사람 조치가 필요한 장 → 묶음이 기다림 · 아직 도는 장 → 대기 · 한 장도 못 그림 → 묶음 실패 · 그 밖 → 그린 장 결과 + 실패한 장 사유
const SETTLED = new Set(["completed", "failed"]);
const MISMATCH = "그림 결과가 이 자리와 맞지 않습니다";

/** @param {Array<{ status: string, error?: string, action: { figureId: string }, event?: { output: { figures: Array<{ id: string }> } } }>} children */
export function judgeBatch(children) {
  const waiting = children.find((child) => child.status === "needs_attention");
  if (waiting) return { kind: "settle", from: waiting };
  if (!children.every((child) => SETTLED.has(child.status))) return { kind: "wait" };
  const parts = children.map((child) => ({
    child,
    figures:
      child.status === "completed"
        ? child.event.output.figures.filter((figure) => figure.id === child.action.figureId)
        : [],
  }));
  const figures = parts.flatMap((part) => part.figures);
  if (!figures.length) {
    const failure = children.find((child) => child.status === "failed");
    return failure ? { kind: "settle", from: failure } : { kind: "invalid" };
  }
  const failed = parts
    .filter((part) => !part.figures.length)
    .map(({ child }) => ({
      id: child.action.figureId,
      error: child.status === "failed" ? child.error : MISMATCH,
    }));
  return { kind: "result", figures, failed };
}
