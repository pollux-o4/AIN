// 사람이 고른 평문 범위 → 원문(마크다운) 앵커 · 화면은 렌더링된 글자로 고르고 서버는 원문으로 저장한다 · ADR-0030
// 평문 투영 규칙의 유일한 정의 · 화면은 후보마다 내려 준 quote만 쓴다
import { FIGURE_LIMITS } from "../../contracts/figure.mjs";

const collapse = (/** @type {string} */ value) => value.replace(/\s+/gu, " ");
// 렌더링하면 보이지 않는 표시: 줄머리(제목·목록), 링크 주소, 인라인 강조·코드 표시
const LINE_MARKS = /^ {0,3}(?:#{1,6}\s+|[-+*]\s+|\d+[.)]\s+)/gm;
const LINKS = /\[([^\]\n]+)\]\([^\n)]*\)/g;
const INLINE = /(\*\*|__|\*|_|`+)(?=\S)(\S(?:[^\n]*?\S)?)\1/g;
const UNIT_HEADINGS = /^#{2,}\s+/gm;

/**
 * 원문 → 접힌 평문과 글자별 원문 구간 · 한 번 훑는 O(n)
 * @param {string} markdown
 */
function project(markdown) {
  const hidden = new Uint8Array(markdown.length);
  const hide = (/** @type {number} */ from, /** @type {number} */ to) => hidden.fill(1, from, to);
  for (const m of markdown.matchAll(LINE_MARKS)) hide(m.index, m.index + m[0].length);
  for (const m of markdown.matchAll(LINKS)) {
    hide(m.index, m.index + 1);
    hide(m.index + 1 + m[1].length, m.index + m[0].length);
  }
  for (const m of markdown.matchAll(INLINE)) {
    hide(m.index, m.index + m[1].length);
    hide(m.index + m[0].length - m[1].length, m.index + m[0].length);
  }
  let plain = "";
  /** @type {Array<{ start: number, end: number }>} */
  const spans = [];
  for (let at = 0; at < markdown.length; at++) {
    if (hidden[at]) continue;
    const space = /\s/u.test(markdown[at]);
    if (space && (!plain || plain.endsWith(" "))) {
      const last = spans.at(-1);
      if (last) last.end = at + 1;
      continue;
    }
    plain += space ? " " : markdown[at];
    spans.push({ start: at, end: at + 1 });
  }
  if (plain.endsWith(" ")) {
    plain = plain.slice(0, -1);
    spans.pop();
  }
  return { plain, spans };
}
export const plainOf = (/** @type {string} */ markdown) => project(markdown).plain;

// 평문에서 exact가 나오는 곳 중 앞뒤 문맥이 맞는 곳 · 문맥 비교는 제자리 비교라 일치마다 O(|문맥|)
function locate(plain, { exact, prefix, suffix }) {
  const before = prefix === undefined ? null : collapse(prefix);
  const after = suffix === undefined ? null : collapse(suffix);
  const found = [];
  for (let at = plain.indexOf(exact); at >= 0; at = plain.indexOf(exact, at + 1)) {
    if (before !== null && !plain.startsWith(before, at - before.length)) continue;
    if (after !== null && !plain.startsWith(after, at + exact.length)) continue;
    found.push(at);
    if (found.length > 1) break;
  }
  return found;
}
const overlapping = (a, b) => a.start < b.end && b.start < a.end;

/**
 * 평문 범위 → 원문 앵커 · 거부 사유는 FIGURE_PLACE_ERRORS의 키
 * @param {string} text 원문
 * @param {{ exact: string, prefix?: string, suffix?: string }} quote
 * @param {Array<{ id: string, anchor: string }>} others 겹침을 검사할 다른 후보
 * @returns {{ anchor: string } | { error: string }}
 */
export function resolveQuote(text, quote, others) {
  const exact = collapse(quote.exact).trim();
  if (!exact) return { error: "not_found" };
  if (exact.length > FIGURE_LIMITS.range) return { error: "too_long" };
  const { plain, spans } = project(text);
  const found = locate(plain, { ...quote, exact });
  if (!found.length) return { error: "not_found" };
  if (found.length > 1) return { error: "ambiguous" };
  const range = { start: spans[found[0]].start, end: spans[found[0] + exact.length - 1].end };
  const anchor = text.slice(range.start, range.end);
  if (anchor.length > FIGURE_LIMITS.range) return { error: "too_long" };
  for (const m of text.matchAll(UNIT_HEADINGS))
    if (m.index > range.start && m.index < range.end) return { error: "crosses_unit" };
  for (const other of others) {
    const at = text.indexOf(other.anchor);
    if (at >= 0 && overlapping(range, { start: at, end: at + other.anchor.length }))
      return { error: "overlaps" };
  }
  return { anchor };
}
