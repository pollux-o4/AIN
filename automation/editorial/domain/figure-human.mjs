// 사람이 후보를 직접 추가·조절·취소하는 편집 명령 · 위치 고르기 단계에서만, AI 호출 없음 · ADR-0030
// 명령마다 (후보 목록, 사건, 원문) → 새 후보 목록 · 실패는 FIGURE_PLACE_ERRORS 키로 던진다
import { FIGURE_LIMITS, FIGURE_PLACE_ERRORS, nextFigureId } from "../../contracts/figure.mjs";
import { resolveQuote } from "./figure-range.mjs";

class FigurePlaceError extends Error {
  constructor(/** @type {keyof typeof FIGURE_PLACE_ERRORS} */ code) {
    super(FIGURE_PLACE_ERRORS[code]);
    this.code = code;
  }
}
const refuse = (code) => {
  throw new FigurePlaceError(code);
};
const isHuman = (candidate) => candidate.origin === "human";

function anchorFor(text, quote, candidates, id) {
  const resolved = resolveQuote(
    text,
    quote,
    candidates.filter((c) => c.id !== id),
  );
  return "error" in resolved ? refuse(resolved.error) : resolved.anchor;
}

// 기존 후보 범위 바꾸기 · 주장은 사람 후보만 바꾼다
function adjust(candidates, { figure, quote, claim }, text) {
  const target = candidates.find((c) => c.id === figure) ?? refuse("unknown");
  if (claim !== undefined && !isHuman(target)) refuse("ai_claim");
  const anchor = anchorFor(text, quote, candidates, figure);
  const said = claim?.trim();
  return candidates.map((c) =>
    c.id === figure ? { ...c, anchor, ...(said ? { claim: said, reason: said } : {}) } : c,
  );
}
// 새 사람 후보 · 근거(reason)는 사람이 적은 주장과 같다 · 목록은 본문 읽는 순서 자리에 끼운다(번호가 본문 순서와 맞게)
function add(candidates, { quote, claim }, text) {
  const id = candidates.length < FIGURE_LIMITS.candidates ? nextFigureId(candidates) : null;
  if (!id) refuse("full");
  const anchor = anchorFor(text, quote, candidates, null);
  const said = claim.trim();
  const at = text.indexOf(anchor);
  const after = candidates.findIndex((c) => text.indexOf(c.anchor) > at);
  const next = [...candidates];
  next.splice(after < 0 ? next.length : after, 0, {
    id,
    anchor,
    claim: said,
    reason: said,
    origin: "human",
  });
  return next;
}

export const HUMAN_EDITS = Object.freeze({
  place_figure: (candidates, event, text) =>
    event.figure === undefined ? add(candidates, event, text) : adjust(candidates, event, text),
  remove_figure: (candidates, { figure }) => {
    const target = candidates.find((c) => c.id === figure) ?? refuse("unknown");
    if (!isHuman(target)) refuse("ai_remove");
    return candidates.filter((c) => c.id !== figure);
  },
});
