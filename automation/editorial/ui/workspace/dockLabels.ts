import type { Run } from "../shared/api";

// 도크가 지금 상태를 알리는 문구 · 실제로 확인된 상태만 말한다(상태 표시 원칙)
type DockState = {
  run: Run;
  blocking: boolean;
  pending: boolean;
  drafting: boolean;
  // 본문에서 위치를 고르는 중이면 고른 수
  picked: number | null;
  reviewingFigures: boolean;
};

function decideTitle({ run, picked, reviewingFigures }: DockState) {
  if (picked !== null) return "시각자료 위치 선택";
  if (reviewingFigures) return "시각자료 확인";
  if (run.canApproveBrief) return "수정 해석 확인";
  if (run.needsCompletion) return "필수 단계 보완";
  return "초안 확정";
}
// 접힌 도크 단추 · 본문에서 고르는 중에는 고른 수와 다음 할 일
function closedLabel({ run, blocking, pending, picked }: DockState) {
  if (picked !== null) return picked ? `${picked}곳 골랐어요 · 만들기` : "만들 곳을 골라 주세요";
  if (blocking) return "확인이 필요해요";
  if (pending) return "진행 내용 보기";
  if (run.canSatisfy) return "확정하거나 고치기";
  if (run.canAuthorizePublication) return "다음 단계 정하기";
  return "고쳐 달라고 하기";
}
// 접힌 도크의 알림 점 · 없으면 null
function dotTitle({ blocking, pending, drafting }: DockState) {
  if (blocking) return "답을 기다리고 있어요";
  if (pending) return "AI가 작업 중이에요";
  if (drafting) return "작성 중인 요청이 있어요";
  return null;
}

export function dockLabels(state: DockState) {
  return { decideTitle: decideTitle(state), closedLabel: closedLabel(state), dot: dotTitle(state) };
}
