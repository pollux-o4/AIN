// 코드 지표: 세거나 글자 그대로 대조할 수 있는 것만 · 뜻을 읽어야 하는 판단(말투·과장·도입부 역할·용어 풀이)은 검토(LLM)의 몫
// 낱말 일치로 뜻을 어림하던 지표는 오판 근거가 되어 뺐다(되묻는 문장 속 "누구나"가 과장어로 잡힌 실측) · ADR-0013
// 분량은 여기서 세지 않음 · 원천 readerLength(draftCharacterCount) · ADR-0009
import {
  headingNodes,
  sectionHeading,
  splitArticle,
  splitSummary,
  subsectionHeading,
} from "../contracts/article-structure.mjs";
import {
  STORY_SLOTS,
  sectionMode,
  sectionTitle,
  usesStoryCard,
} from "../contracts/writing-modes.mjs";

const chars = (value) => Array.from(value).length;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

// 표·코드 블록·제목은 문장 길이 계산에서 제외
function proseLines(text) {
  let fenced = false;
  return text.split("\n").filter((line) => {
    if (line.startsWith("```")) fenced = !fenced;
    return !fenced && !/^\s*(#|\||```)/.test(line);
  });
}

const sentencesOf = (text) =>
  proseLines(text)
    .join(" ")
    .split(/(?<=[.!?。])\s+|(?<=다\.)\s*/)
    .map((s) => s.trim())
    .filter((s) => chars(s) > 1);

// 목록(참고 문헌 등)은 항목 하나를 한 단위로 잰다
const paragraphsOf = (text) =>
  text
    .split(/\n\s*\n/)
    .flatMap((p) =>
      proseLines(p)
        .join("\n")
        .split(/\n(?=\s*(?:[-*+]|\d+\.)\s)/),
    )
    .map((p) => p.trim())
    .filter(Boolean);

// 대조용 정규화: 강조 기호·공백 차이는 같은 문장으로 본다
const plain = (value) => String(value).replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
const count = (haystack, needle) => (needle ? haystack.split(needle).length - 1 : 0);

// 본문 문장은 싣지 않는다(검토 자료에 초고가 이미 있음) · 순서가 구간 번호
function sectionShape(part) {
  return {
    questions: count(part, "?"),
    bold: part.match(/\*\*[^*\n]+\*\*/g)?.length ?? 0,
    longParagraphs: paragraphsOf(part).filter((p) => sentencesOf(p).length > 6).length,
  };
}

// 제목과 끝 정리 목록만 글자 대조 · 본문의 여는 문장·강조·마무리 문장은 문맥에 맞게 고쳐 쓰므로 뜻은 검토가 판단 · ADR-0013·ADR-0029
function cardTransfer(text, outline) {
  const cards = (outline?.sections ?? []).filter(
    (section) => usesStoryCard(sectionMode(section)) && STORY_SLOTS.some((name) => section[name]),
  );
  if (!cards.length && !outline?.title) return undefined;
  // 끝 정리는 본문이 원본: 항목마다 본문에 글자 그대로 있어야 하고, 구간 카드 수만큼 있어야 함
  const { body: main, summary } = splitSummary(text);
  const mainText = plain(main);
  return {
    ...(outline?.title
      ? { titleMatches: plain(text.match(/^#\s+(.+)$/m)?.[1] ?? "") === plain(outline.title) }
      : {}),
    summaryNotInBody: summary.filter((item) => !mainText.includes(plain(item))),
    summaryCount: { expected: cards.length, actual: summary.length },
  };
}

// 구성 나무의 소제목 줄(구간 + 하위 항목, 단계 포함) · ADR-0014
function expectedHeadings(outline) {
  const lines = [];
  const walk = (nodes, depth) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      const title = String(node?.title ?? "").trim();
      if (!title) continue;
      lines.push({ title, line: subsectionHeading(title, depth) });
      walk(node.subsections, depth + 1);
    }
  };
  for (const section of outline?.sections ?? []) {
    const title = sectionTitle(section);
    if (!title) continue;
    lines.push({ title, line: sectionHeading(title) });
    walk(section?.subsections, 1);
  }
  return lines;
}

// 구성의 소제목이 같은 단계 소제목 줄로 실렸는지 · 훑어 읽는 독자가 따라가는 줄(S9)
function missingHeadings(text, outline) {
  const present = new Set(
    headingNodes(text).map((node) => plain(`${"#".repeat(node.level)} ${node.title}`)),
  );
  return expectedHeadings(outline)
    .filter(({ line }) => !present.has(plain(line)))
    .map(({ title }) => title);
}

// 소제목 나무 모양: 단계 건너뛰기 · 자식 하나뿐인 하위 항목 · 한 단계 최대 형제 수(제목 바로 아래 포함)
function headingTree(text) {
  const nodes = headingNodes(text);
  const children = new Map();
  let skippedLevels = 0;
  nodes.forEach((node) => {
    const parentLevel = node.parent < 0 ? 1 : nodes[node.parent].level;
    if (node.level > parentLevel + 1) skippedLevels += 1;
    children.set(node.parent, (children.get(node.parent) ?? 0) + 1);
  });
  const counts = [...children.entries()];
  return {
    depth: Math.max(1, ...nodes.map((node) => node.level)),
    skippedLevels,
    singleChildren: counts.filter(([parent, n]) => parent >= 0 && n === 1).length,
    maxSiblings: Math.max(0, ...counts.map(([, n]) => n)),
  };
}

// 지표마다 판정 근거 · JUDGE-001: 코드가 내는 지표는 count(세기)·exact(글자 그대로 대조)뿐
// 새 지표는 여기에 등록한다 · 등록되지 않았거나 다른 근거의 지표는 tests/judge-001이 거부한다
export const METRIC_BASIS = Object.freeze({
  sentenceLength: "count",
  longestParagraph: "count",
  headingCount: "count",
  longestSection: "count",
  sections: "count",
  missingHeadings: "exact",
  headingTree: "count",
  cardTransfer: "exact",
});

/**
 * @param {string} text 초고 본문(마크다운)
 * @param {{ outline?: Record<string, any> }} [design]
 */
export function draftMetrics(text, { outline } = {}) {
  const sentences = sentencesOf(text);
  const lengths = sentences.map(chars).sort((a, b) => a - b);
  const headings = [...text.matchAll(/^#{2,6}\s.+$/gm)].map((m) => m.index);
  const gaps = headings.map((at, i) => (headings[i + 1] ?? text.length) - at);
  const transfer = cardTransfer(text, outline);
  return {
    sentenceLength: { median: percentile(lengths, 0.5), p90: percentile(lengths, 0.9) },
    longestParagraph: Math.max(0, ...paragraphsOf(text).map(chars)),
    headingCount: headings.length,
    ...(outline?.sections ? { missingHeadings: missingHeadings(text, outline) } : {}),
    headingTree: headingTree(text),
    longestSection: Math.max(0, ...gaps),
    sections: splitArticle(text).sections.map(sectionShape),
    ...(transfer ? { cardTransfer: transfer } : {}),
  };
}
