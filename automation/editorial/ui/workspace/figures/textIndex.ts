// 렌더링된 본문의 글자 색인(Facade) · 본문이 바뀔 때 한 번 만들고 찾기·선택 맞춤·문장 조절이 함께 쓴다 · ADR-0030
// 평문 비교 규칙(연속 공백 하나·블록 사이 공백 하나)은 서버 figure-range.mjs와 같다
// 마크다운 → 평문 투영은 서버만 맡고(후보 quote), 여기서는 화면 글자만 다룬다

const QUOTE_CONTEXT = 32;
const BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, dt, dd";
// 본문이 아닌 덧붙임(시각자료 자리·그림·패널)
const SKIP = ".figure-slot, figure, .figure-place";
const collapse = (value: string) => value.replace(/\s+/g, " ").trim();

type Quote = { exact: string; prefix?: string; suffix?: string };
// 본문에서 고른 범위 · start·end는 접힌 평문 위치
export type Picked = { start: number; end: number; quote: Quote; range: Range };
type Slot = { node: Text; offset: number; gap?: true };
type Span = readonly [number, number];

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("ko", { granularity: "sentence" })
    : null;

export class TextIndex {
  private readonly text: string;
  private readonly slots: Slot[];
  private sentenceCache: Span[] | null = null;

  constructor(private readonly root: HTMLElement) {
    const slots: Slot[] = [];
    let text = "";
    let block: Element | null = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (
      let node = walker.nextNode() as Text | null;
      node;
      node = walker.nextNode() as Text | null
    ) {
      // 블록 사이에만 공백 하나 · 굵게·코드 같은 인라인 경계는 그대로 잇는다
      const own = node.parentElement?.closest(BLOCKS) ?? null;
      if (own !== block && text && !text.endsWith(" ")) {
        text += " ";
        slots.push({ node, offset: 0, gap: true });
      }
      block = own;
      for (let i = 0; i < node.data.length; i++) {
        const space = /\s/.test(node.data[i]);
        if (space && (!text || text.endsWith(" "))) continue;
        text += space ? " " : node.data[i];
        slots.push({ node, offset: i });
      }
    }
    this.text = text;
    this.slots = slots;
  }

  // 색인을 만든 본문 요소가 그대로인가 · 본문이 다시 그려지면 새로 만든다
  covers(root: HTMLElement) {
    return root === this.root && this.root.isConnected;
  }

  // 문장 구간 · 처음 쓸 때 한 번 나눈다
  private get sentences(): Span[] {
    if (this.sentenceCache) return this.sentenceCache;
    const all: Span[] = segmenter
      ? Array.from(segmenter.segment(this.text), ({ index, segment }) => {
          const lead = segment.length - segment.trimStart().length;
          return [index + lead, index + segment.trimEnd().length] as const;
        })
      : [[0, this.text.length]];
    // 블록 경계도 문장 경계 · 마침표 없는 제목이 다음 문단 첫 문장에 붙지 않게
    const split: Span[] = [];
    for (const [from, to] of all) {
      let start = from;
      for (let at = from; at < to; at++)
        if (this.slots[at]?.gap) {
          split.push([start, at]);
          start = at + 1;
        }
      split.push([start, to]);
    }
    this.sentenceCache = split.filter(([from, to]) => to > from);
    return this.sentenceCache;
  }

  private picked(from: number, to: number): Picked | null {
    let start = from;
    let end = to;
    while (start < end && this.slots[start]?.gap) start++;
    while (end > start && this.slots[end - 1]?.gap) end--;
    const first = this.slots[start];
    const last = this.slots[end - 1];
    const exact = this.text.slice(start, end);
    if (!first || !last || !exact.trim()) return null;
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset + 1);
    const prefix = this.text.slice(Math.max(0, start - QUOTE_CONTEXT), start);
    const suffix = this.text.slice(end, end + QUOTE_CONTEXT);
    return {
      start,
      end,
      range,
      quote: { exact, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) },
    };
  }

  // 걸친 문장을 통째로 · 문장 구간은 정렬돼 있어 이분 탐색 O(log s)
  private snapped(from: number, to: number) {
    const list = this.sentences;
    const first = lowerBound(list, (s) => s[1] > from);
    let last = first;
    while (last + 1 < list.length && list[last + 1][0] < to) last++;
    if (first >= list.length || list[first][0] >= to) return this.picked(from, to);
    return this.picked(Math.min(from, list[first][0]), Math.max(to, list[last][1]));
  }

  // 서버가 준 평문 quote 위치 · 첫 위치(서버가 같은 글이 여러 곳이면 거부하므로 하나)
  find(quote: string): Picked | null {
    const wanted = collapse(quote);
    const at = wanted ? this.text.indexOf(wanted) : -1;
    return at < 0 ? null : this.picked(at, at + wanted.length);
  }

  // 지금 선택을 문장 단위로 넓혀 범위로 · 본문 밖이거나 비면 null
  // 선택 양 끝 글자 위치는 이분 탐색(문서 순서 비교) O(log n)
  fromSelection(selection: Selection | null): Picked | null {
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const chosen = selection.getRangeAt(0);
    if (!this.root.contains(chosen.commonAncestorContainer)) return null;
    const after = (slot: Slot) => chosen.comparePoint(slot.node, slot.offset) >= 0;
    const before = (slot: Slot) => chosen.comparePoint(slot.node, slot.offset + 1) > 0;
    const start = lowerBound(this.slots, after);
    const end = lowerBound(this.slots, before);
    return end > start ? this.snapped(start, end) : null;
  }

  // 한쪽 끝을 한 문장씩 늘이거나 줄인다 · 끌기 없이 키보드·화면 낭독기로 조절하는 길(WCAG 2.5.7)
  step(picked: Picked, edge: "start" | "end", grow: boolean): Picked | null {
    const list = this.sentences;
    const inside = list.filter(([a, b]) => a >= picked.start && b <= picked.end);
    if (edge === "start") {
      if (!grow) return inside.length > 1 ? this.picked(inside[1][0], picked.end) : null;
      const before = list[lowerBound(list, (s) => s[1] > picked.start) - 1];
      return before ? this.picked(before[0], picked.end) : null;
    }
    if (!grow)
      return inside.length > 1 ? this.picked(picked.start, inside[inside.length - 2][1]) : null;
    const after = list[lowerBound(list, (s) => s[0] >= picked.end)];
    return after ? this.picked(picked.start, after[1]) : null;
  }
}

// 단조 조건을 처음 만족하는 위치 · 없으면 길이
function lowerBound<T>(list: readonly T[], ok: (item: T) => boolean) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (ok(list[mid])) high = mid;
    else low = mid + 1;
  }
  return low;
}

export const overlaps = (a: Picked, b: Picked) => a.start < b.end && b.start < a.end;
// 화면 선택을 범위에 맞춘다 · 범위 조절을 시작할 때 사람이 이어서 끌 수 있게
export function selectPicked(picked: Picked) {
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(picked.range.cloneRange());
}
