// 동작 카탈로그 SSoT · 서버 권한·CLI 명령·화면이 같은 표를 쓴다 · ADR-0006·FIGURE-001
// actor: agent=지시(에이전트도 가능) · human=결과물 수락(사람만)
// cost=AI 호출 · round=에이전트 수정 지시 한도에 셈 · text=본문 의견 입력(필수면 이름)
export const ACTIONS = Object.freeze({
  feedback: { actor: "agent", cost: true, round: true, text: "수정 내용", summary: "수정 요청" },
  revise_brief: {
    actor: "agent",
    cost: true,
    round: true,
    text: "보정 의견",
    summary: "수정 해석 다시 요청",
  },
  approve_brief: { actor: "agent", cost: true, summary: "수정 해석 승인 → 수정 착수" },
  pause: { actor: "agent", summary: "일시 중지" },
  resume: { actor: "agent", cost: true, summary: "재개" },
  complete_requirements: { actor: "agent", cost: true, summary: "요구사항 보완" },
  request_figures: { actor: "agent", cost: true, summary: "시각자료 위치 제안(선택: 위치 지시)" },
  // 사람이 본문 범위로 자리 추가·범위 조절·취소 · AI 호출 없음 · ADR-0030
  place_figure: { actor: "agent", summary: "시각자료 자리 추가·범위 조절" },
  remove_figure: { actor: "agent", summary: "직접 추가한 시각자료 자리 취소" },
  select_figures: { actor: "agent", cost: true, summary: "만들 위치·스타일 선택 → 구성" },
  approve_design: { actor: "agent", cost: true, summary: "구성 승인 → 그림 생성" },
  revise_design: {
    actor: "agent",
    cost: true,
    round: true,
    text: "수정 의견",
    summary: "구성 다시 요청",
  },
  revise_figures: {
    actor: "agent",
    cost: true,
    round: true,
    text: "수정 의견",
    summary: "그림 수정 요청",
  },
  retry_figures: { actor: "agent", cost: true, summary: "실패한 그림만 다시 그리기" },
  confirm_figures: { actor: "human", summary: "시각자료 확정" },
  discard_figures: { actor: "human", summary: "시각자료 버리기" },
  satisfy: { actor: "human", summary: "만족(최종 검수)" },
  authorize_publication: { actor: "human", summary: "발행 준비 승인" },
});
/** @typedef {{ actor: "agent" | "human", cost?: boolean, round?: boolean, text?: string, summary: string }} ActionSpec */
/** @type {(type: string) => ActionSpec | undefined} */
export const actionSpec = (type) => /** @type {Record<string, ActionSpec>} */ (ACTIONS)[type];
/** @type {[keyof typeof ACTIONS, ...(keyof typeof ACTIONS)[]]} */
export const ACTION_TYPES = /** @type {any} */ (Object.keys(ACTIONS));
/** @param {string} type @param {"user" | "agent"} actor */
export const actionAllowed = (type, actor) =>
  actor !== "agent" || actionSpec(type)?.actor === "agent";
/** @param {string} type */
const countsAsRound = (type) => Boolean(actionSpec(type)?.round);
// 에이전트 수정 지시 한도는 에이전트가 스스로 판단한 지시(편집장 자동 수정)에만 셈 · 사용자가 맡긴 요청(delegated)은 사용자 지시로 본다 · ADR-0006
/** @param {string} type @param {{ by?: string, delegated?: boolean }} who */
export const agentRound = (type, { by, delegated }) =>
  by === "agent" && !delegated && countsAsRound(type);
