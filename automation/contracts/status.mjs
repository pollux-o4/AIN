// AI 작업을 기다리는 상태 SSoT · 서비스 루프·CLI 대기·종료 판단·화면 폴링이 같은 목록 사용
const PENDING_STATUSES = Object.freeze(["waiting_ai", "waiting_route", "waiting_figure"]);
/** @param {unknown} status */
export const isPendingStatus = (status) =>
  typeof status === "string" && PENDING_STATUSES.includes(status);
