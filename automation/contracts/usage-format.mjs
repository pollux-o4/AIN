// 사용량 표기 · CLI·화면 공통
export const OUTCOME_LABEL = {
  accepted: "수용",
  rejected: "거부",
  failed: "실패",
  running: "진행 중",
};

/** @param {number} ms */
export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`;
}

/** @param {number | null} n */
export const formatTokens = (n) =>
  n === null ? "토큰 기록 없음" : `토큰 ${n.toLocaleString("en-US")}`;

/** @param {{ ms: number, tokens: number | null, calls: number, wasted: number }} c */
export const formatCost = (c) =>
  `${formatDuration(c.ms)} · ${formatTokens(c.tokens)} · 호출 ${c.calls}회${c.wasted ? ` · 낭비 ${c.wasted}회` : ""}`;
