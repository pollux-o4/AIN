// 짧은 항목(글 제목·구간 한 줄 항목)의 규칙 단일 정의 · ADR-0020
// role: 쓰는 AI의 항목 안내이자 검토 AI의 점검 질문 · max: 코드가 세는 글자 수 상한(공백 포함) · basis: 근거
// 뜻(역할을 하는가)은 검토가, 글자 수는 코드가 본다(JUDGE-001) · 새 항목은 여기에 한 줄을 더해 확장한다
// shortcut: 상한은 한국어 표본 근거가 없는 어림값(RES-007 한계), 실제 글 표본이 쌓이면 조정

/** @typedef {{ role: string, max: number, basis: string }} SlotRule */

export const SLOT_RULES = Object.freeze({
  title: {
    role: "독자가 글을 고를 때 읽는 짧은 문구로, 이 글에서 얻을 것을 쉬운 낱말로 담는다. 본문 문장처럼 '…습니다'·'…이다'로 끝맺는 설명문으로 쓰지 않는다.",
    max: 25,
    basis: "RES-007 S1 · Shulman 2024",
  },
  hook: {
    role: "구간의 첫 문장이 될 질문이나 통념을 뒤집는 주장이다.",
    max: 50,
    basis: "RES-007 S3",
  },
  underline: {
    role: "구간의 핵심을 독자가 기억하기 쉬운 일상어로 쓴 1문장이다. 비유는 analogySystem이 있을 때 그 비유만 사용한다.",
    max: 45,
    basis: "RES-007 S7",
  },
  principleLine: {
    role: "구간을 읽은 독자가 가져갈 판단이나 행동을 diagnose.preserveVoice의 말투로 쓴 1문장이다.",
    max: 40,
    basis: "RES-007 S8",
  },
});

/** 구간 카드의 한 줄 항목 · 나머지(title)는 글 전체 항목 */
export const SECTION_LINES = /** @type {const} */ (["hook", "underline", "principleLine"]);

/** 쓰는 AI에게 주는 항목 안내 @param {keyof typeof SLOT_RULES} name */
export const slotGuide = (name) =>
  `${SLOT_RULES[name].role} ${SLOT_RULES[name].max}자 이내로 적는다.`;

/** 검토 AI·자기 점검용 질문 @param {keyof typeof SLOT_RULES} name @param {string} label */
export const slotCheck = (name, label) =>
  `${label}이(가) 다음 역할을 하는가: ${SLOT_RULES[name].role} (${SLOT_RULES[name].max}자 이내는 시스템이 세어 넘으면 거부한다)`;
