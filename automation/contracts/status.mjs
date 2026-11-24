// AI 작업을 기다리는 상태 SSoT · 서비스 루프·CLI 대기·종료 판단·화면 폴링이 같은 목록 사용
export const PENDING_STATUSES = Object.freeze(["waiting_ai", "waiting_route", "waiting_figure"]);
/** @param {unknown} status */
export const isPendingStatus = (status) =>
  typeof status === "string" && PENDING_STATUSES.includes(status);
// 사람이 발행 준비를 승인한 상태 · 다른 프로젝트로 넘길 수 있는 글은 이것뿐(ADR-0012)
export const PUBLICATION_READY = "publication_ready";
