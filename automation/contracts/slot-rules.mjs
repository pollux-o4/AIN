// 짧은 항목(글 제목·독자 과제·약속·구간 한 줄 항목)의 규칙 단일 정의 · ADR-0020
// role: 쓰는 AI의 항목 안내이자 검토 AI의 점검 질문 · max: 코드가 세는 글자 수 상한(공백 포함, 없으면 세지 않음) · basis: 근거
// 뜻(역할을 하는가)은 검토가, 글자 수는 코드가 본다(JUDGE-001) · 새 항목은 여기에 한 줄을 더해 확장한다
import { NATURAL_KOREAN } from "./natural-korean.mjs";

// 짧은 항목은 독자에게 그대로 보이므로 안내·점검 질문에 자연스러운 한국어 기준(SLOT)을 함께 싣는다
// shortcut: 상한은 한국어 표본 근거가 없는 어림값(RES-007 한계), 실제 글 표본이 쌓이면 조정

/** @typedef {{ role: string, max?: number, basis: string }} SlotRule */

/** @type {Readonly<Record<"title" | "readerTask" | "promise" | "hook" | "underline" | "principleLine", SlotRule>>} */
export const SLOT_RULES = Object.freeze({
  title: {
    role: "독자가 글을 고를 때 읽는 짧은 문구로, 이 글에서 얻을 것을 쉬운 낱말로 담는다. 본문 문장처럼 '…습니다'·'…이다'로 끝맺는 설명문으로 쓰지 않는다.",
    max: 25,
    basis: "RES-007 S1 · Shulman 2024",
  },
  readerTask: {
    role: "글을 읽은 뒤 독자가 해낼 일을 담은 1문장이다. 문형은 정하지 않는다.",
    basis: "RES-005 독자 카드",
  },
  promise: {
    role: "독자에게 건네는 약속 1문장으로, 글을 읽고 독자가 얻을 것을 담는다. 문형은 정하지 않는다.",
    basis: "RES-008 L2",
  },
  hook: {
    role: "구간에서 독자가 품을 궁금증을 여는 문장으로, 독자가 속으로 물을 법한 질문이나 예상을 뒤집는 주장이다. 질문은 글의 문체를 지키면서 독자가 실제로 말하듯 묻는 형태로 쓴다. 구간마다 같은 형태만 이어지지 않도록 두 형태를 내용에 맞게 섞는다.",
    max: 50,
    basis: "RES-007 S3",
  },
  underline: {
    role: "구간의 핵심을 독자가 기억하기 쉬운 일상어로 쓴 1문장이다. 비유는 analogySystem이 있을 때 그 비유만 사용한다.",
    max: 45,
    basis: "RES-007 S7",
  },
  principleLine: {
    role: "구간을 읽은 독자가 가져갈 판단이나 행동을 diagnose.preserveVoice의 말투로 쓴 1문장이다. 권하는 문장이나 단정하는 문장으로 쓰고, 구간마다 같은 형태만 이어지지 않게 한다.",
    max: 40,
    basis: "RES-007 S8",
  },
});

/** 구간 카드의 한 줄 항목 · 나머지(title)는 글 전체 항목 */
export const SECTION_LINES = /** @type {const} */ (["hook", "underline", "principleLine"]);

/** 쓰는 AI에게 주는 항목 안내 @param {keyof typeof SLOT_RULES} name */
export const slotGuide = (name) => {
  const { role, max } = SLOT_RULES[name];
  return `${role} ${NATURAL_KOREAN.SLOT.draft}${max ? ` ${max}자 이내로 적는다.` : ""}`;
};

/** 검토 AI·자기 점검용 질문 @param {keyof typeof SLOT_RULES} name @param {string} label */
export const slotCheck = (name, label) => {
  const { role, max } = SLOT_RULES[name];
  const limit = max ? ` (${max}자를 넘으면 시스템이 거부한다)` : "";
  return `${label} 항목이 다음 역할에 맞는가: ${role} ${NATURAL_KOREAN.SLOT.check}${limit}`;
};
