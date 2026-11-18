// 요구사항 목록(ADR-0016) 이전 글의 요구를 한 번 요구사항 목록으로 옮긴다 · 새 글은 쓰지 않는다
// 이전 규칙: (의뢰 값) → 편집 메모 분량 → 최근 사람 피드백·글감 문장의 분량 표현
// shortcut: 이전 글 변환용 문장 패턴 파싱이 남음, 요구사항 목록 없는 글이 저장소에서 사라지면 이 파일 삭제

const NEAR = 0.1; // "안팎·내외" 허용 폭
const num = (text) => Number(text.replaceAll(",", ""));
const LENGTH_PATTERNS = [
  [/(\d[\d,]*)\s*자?\s*[~\-–]\s*(\d[\d,]*)\s*자/, (m) => [num(m[1]), num(m[2])]],
  [
    /(\d[\d,]*)\s*자\s*\(?\s*±\s*(\d+)\s*%/,
    (m) => [num(m[1]) * (1 - m[2] / 100), num(m[1]) * (1 + m[2] / 100)],
  ],
  [
    /(\d[\d,]*)\s*자\s*(?:안팎|내외|정도|전후|가량)/,
    (m) => [num(m[1]) * (1 - NEAR), num(m[1]) * (1 + NEAR)],
  ],
  [/(\d[\d,]*)\s*자\s*(?:이내|이하|까지)/, (m) => [0, num(m[1])]],
  [/(\d[\d,]*)\s*자\s*(?:이상|넘게)/, (m) => [num(m[1]), null]],
];

export function parseLength(text) {
  if (typeof text !== "string") return null;
  for (const [pattern, range] of LENGTH_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const [min, max] = range(match).map((v) => (v === null ? null : Math.round(v)));
    if ((max === null || min <= max) && (max ?? min) >= 100) return { min, max };
  }
  return null;
}

function legacyLength(state) {
  if (state.direction?.targetLength) return null; // formChanges가 옮김
  if (state.brief?.acceptance?.length) return state.brief.acceptance.length;
  const past = (state.history ?? [])
    .filter((h) => h.feedbackSource !== "auto")
    .map((h) => h.feedback);
  const current = state.feedbackSource === "auto" ? null : state.feedback;
  for (const text of [current, ...past.toReversed(), state.idea]) {
    const found = parseLength(text);
    if (found) return found;
  }
  return null;
}

/** 의뢰 선택값 외에 이전 규칙으로 찾던 분량 · 의뢰 선택값 변환은 요구사항 목록(formChanges)이 맡음 */
export function legacyChanges(state) {
  const length = legacyLength(state);
  return length ? [{ kind: "length", op: "set", value: length, quote: "이전 기록" }] : [];
}
