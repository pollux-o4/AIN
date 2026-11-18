// 글 본문 구조의 단일 정의: "# 제목" + 도입(lead) + "## 소제목" 구간들 · 초고 프롬프트·코드 지표·분량 안내·기준본 찾기가 함께 쓴다
// 구간 안 하위 마디는 "###" 이하로 내용의 나무를 따른다(깊이 상한 없음) · 끝 정리는 본문 나무 밖 "## 한눈에 정리" · ADR-0014

const SECTION_START = /^(?=##\s)/m;
const SUMMARY_TITLE = "한눈에 정리";

/** 구간 소제목 줄 · 초고가 쓰고 지표가 대조하는 같은 형식 */
export const sectionHeading = (/** @type {string} */ title) => `## ${title}`;

/** 하위 마디 소제목 줄 · depth 1 = 구간 바로 아래(###) */
export const subsectionHeading = (/** @type {string} */ title, /** @type {number} */ depth) =>
  `${"#".repeat(depth + 2)} ${title}`;

/** 글 끝 정리 소제목 줄 · 본문 나무와 같은 단계에 서지만 구간은 아니다 */
export const summaryHeading = sectionHeading(SUMMARY_TITLE);

const isSummary = (/** @type {string} */ part) => part.split("\n")[0].trim() === summaryHeading;

/**
 * @param {string} text
 * @returns {{ lead: string, sections: string[] }} lead: 첫 소제목 앞(제목·도입) · sections: 소제목으로 시작하는 구간
 * 끝 정리는 마지막 구간에 붙인다(구간 예산·기준본이 끝 정리를 마지막 구간 몫으로 셈)
 */
export function splitArticle(text) {
  const [first = "", ...rest] = text.split(SECTION_START);
  const { lead, sections } = first.startsWith("## ")
    ? { lead: "", sections: [first, ...rest] }
    : { lead: first, sections: rest };
  const summaryAt = sections.findIndex(isSummary);
  if (summaryAt < 1) return { lead, sections };
  return {
    lead,
    sections: [...sections.slice(0, summaryAt - 1), sections.slice(summaryAt - 1).join("")],
  };
}

/**
 * 본문 소제목 나무(제목 아래) · 코드 블록·끝 정리 제외
 * @param {string} text
 * @returns {{ level: number, title: string, parent: number }[]} parent: 부모 소제목 번호(-1 = 제목)
 */
export function headingNodes(text) {
  let fenced = false;
  /** @type {{ level: number, title: string, parent: number }[]} */
  const nodes = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    const match = !fenced && line.match(/^(#{2,})\s+(.+?)\s*$/);
    if (!match) continue;
    if (line.trim() === summaryHeading) break;
    const level = match[1].length;
    let parent = nodes.length - 1;
    while (parent >= 0 && nodes[parent].level >= level) parent = nodes[parent].parent;
    nodes.push({ level, title: match[2], parent });
  }
  return nodes;
}
