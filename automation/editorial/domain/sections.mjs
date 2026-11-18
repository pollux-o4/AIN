// 구간별 초고: 구성(outline)의 구간을 하나씩 쓰고 구간 예산을 코드로 검사 · ADR-0009
// 지면 단위 원고(뉴스룸 budget)와 같은 방식 · 모델이 전체 분량을 지키지 못한 실측(7~9천 자) 근거
import { splitArticle } from "../../contracts/article-structure.mjs";
import { SECTION_LINES, SLOT_RULES } from "../../contracts/slot-rules.mjs";
import {
  CARD_SPACE,
  MAX_CASES,
  STORY_SLOTS,
  sectionMode,
  usesStoryCard,
} from "../../contracts/writing-modes.mjs";
import { readerLength } from "./length.mjs";
import { requirements } from "./requirements.mjs";

const MAX_SECTIONS = 8;
const OVER_BUDGET = 1.25; // 예산 대비 허용 초과 비율 · 넘으면 그 구간만 다시
const JOINT = "\n\n"; // 구간을 잇는 빈 줄 · 분량에 포함된다
// 같은 단계 안 다시 쓰기 상한 · 소진 후에도 위반이면 수용하지 않고 실패(이어가기로 재개, 지적은 유지)
const RETRY_LIMIT = { outline: 1, draft: 3 };

const titleOf = (section) =>
  typeof section === "string" ? section : String(section?.title ?? "").trim();

// 위반 결과를 거부하고 다시 요청 · 상한 소진이면 실패로 멈춤
// 실패 후 이어가기는 같은 지적(note)으로 상한을 새로 받음 · 위반 결과를 다음 단계로 넘기지 않음
// state.retry: 진행 중 다시 쓰기 하나 · rejected는 거부된 원고(다시 쓰기는 이를 줄이는 편집)
export function reject(state, stage, { index, note, error, rejected }) {
  const same = state.retry?.stage === stage && state.retry.index === index;
  const attempts = same ? state.retry.attempts : 0;
  const exhausted = attempts >= RETRY_LIMIT[stage];
  state.retry = { stage, index, note, rejected, attempts: exhausted ? 0 : attempts + 1 };
  if (!exhausted) return;
  state.resumeStatus = state.status;
  state.status = "failed";
  state.error = error;
}

// 같은 단계 안에서 이어지는 호출인가: 구간별 초고의 다음 구간 · 검사가 거부한 결과의 다시 쓰기
// 서비스는 이런 호출을 단계 예산에 넣지 않는다 · 횟수는 여기 상한(MAX_SECTIONS·RETRY_LIMIT)이 막는다
export const continuesStage = (state) =>
  (state.stage === "draft" && Boolean(state.draftParts?.length)) ||
  state.retry?.stage === state.stage;

// 구성 예산 검사: 분량 요구가 있으면 2~8구간 모두 budget, 합계는 요구 범위 안 · 위반 사유 또는 null
function budgetIssue(state, output) {
  const length = requirements(state).length;
  if (!length) return null;
  const sections = output.sections;
  if (sections.length < 2 || sections.length > MAX_SECTIONS)
    return `구간은 2~${MAX_SECTIONS}개여야 한다(현재 ${sections.length}개).`;
  const budgets = sections.map((section) => Number(section?.budget));
  if (!budgets.every((b) => Number.isInteger(b) && b > 0))
    return "모든 구간에 budget(공백 포함 글자 수, 양의 정수)을 적어야 한다.";
  const sum = budgets.reduce((a, b) => a + b, 0);
  const max = length.max ?? Math.round(length.min * 1.2);
  if (sum < length.min || sum > max)
    return `budget 합계 ${sum}자가 요구 ${length.min}~${max}자 밖이다. 합계를 범위 안으로 맞추고 필요하면 구간 수를 줄인다.`;
  return spaceIssue(sections, budgets, max);
}

// 구간이 맡은 항목을 문장으로 옮길 지면 · 구간 카드 구간·도입부·끝 정리 몫의 합
function sectionFloor(sections, index) {
  const last = sections.length - 1;
  return (
    (usesStoryCard(sectionMode(sections[index])) ? CARD_SPACE.section : 0) +
    (index === 0 ? CARD_SPACE.intro : 0) +
    (index === last ? CARD_SPACE.summaryLine * sections.length : 0)
  );
}

// 지면 검사: 구간 수가 요구 분량에 비해 많으면 구간마다 항목을 담지 못한다 · 구간 수를 줄이게 한다
// shortcut: 2구간으로도 지면이 안 나오는 짧은 글은 검사하지 않음(항목을 줄여 쓰는 짧은 글 카드가 없음), 짧은 글 요청이 실제로 생기면 카드 축약 규칙 추가
function spaceIssue(sections, budgets, max) {
  const floors = sections.map((_section, index) => sectionFloor(sections, index));
  const tight = budgets.flatMap((budget, index) =>
    budget < floors[index] ? [`${index + 1}번 ${budget}자 < ${floors[index]}자`] : [],
  );
  if (!tight.length) return null;
  const fewest = sections.slice(0, 2);
  const feasible = sectionFloor(fewest, 0) + sectionFloor(fewest, 1) <= max;
  return feasible
    ? `구간 budget이 항목을 옮길 지면보다 작다 → ${tight.join(" / ")}. 구간 수를 줄여 구간마다 지면을 확보한다.`
    : null;
}

const filled = (value) =>
  Array.isArray(value)
    ? value.length > 0 && value.every(filled)
    : typeof value === "string" && value.trim().length > 0;

// 구간 카드 검사: 초고가 옮겨 쓸 항목이 비면 글 수준이 모델에 따라 갈림 · 카드 형식 구간만(이전 문자열 구간 제외) · ADR-0013
function cardIssue(output) {
  const gaps = output.sections.flatMap((section, index) => {
    if (!usesStoryCard(sectionMode(section))) return [];
    const missing = STORY_SLOTS.filter((name) => !filled(section[name]));
    if (Array.isArray(section.cases) && section.cases.length > MAX_CASES)
      missing.push(`cases는 ${MAX_CASES}개 이하`);
    // 한 줄 항목은 짧아야 강조 문장·마무리 문장 구실을 한다 · 글자 수만 센다(뜻은 검토의 몫 · JUDGE-001)
    for (const name of SECTION_LINES) {
      const over = overLimit(name, section[name]);
      if (over) missing.push(over);
    }
    return missing.length ? [`${index + 1}번 "${titleOf(section)}": ${missing.join("·")}`] : [];
  });
  return gaps.length
    ? `구간 카드의 항목을 고친다(빈 항목은 채우고 긴 항목은 줄인다) → ${gaps.join(" / ")}.`
    : null;
}

// 짧은 항목의 글자 수 상한(규칙표) · 넘으면 위반 문구, 아니면 null · 세기만 한다(뜻은 검토 · JUDGE-001)
function overLimit(name, value) {
  const { max } = SLOT_RULES[name];
  const size = typeof value === "string" ? readerLength(value.trim()) : 0;
  return size > max ? `${name} ${size}자 → ${max}자 이내` : null;
}

// 글 제목 검사: 구성이 정한 제목은 규칙표 상한 안이어야 한다
function titleIssue(output) {
  const over = overLimit("title", output.title);
  return over ? `글 제목을 고친다 → ${over}.` : null;
}

const OUTLINE_CHECKS = [
  budgetIssue,
  (_state, output) => cardIssue(output),
  (_state, output) => titleIssue(output),
];

// 구성 결과 수용 · 위반이면 거부(다시 또는 실패) · 수용 시 true
export function acceptOutline(state, output) {
  const issues = OUTLINE_CHECKS.map((check) => check(state, output)).filter(Boolean);
  if (!issues.length) {
    delete state.retry;
    return true;
  }
  const issue = issues.join(" ");
  reject(state, "outline", { index: 0, note: issue, error: `구성 검사 위반이 반복됨: ${issue}` });
  return false;
}

// 구간 예산: 구성의 budget만 사용(분량 요구가 있으면 구성 검사가 모든 구간 budget을 보장) · 없으면 한 번에 작성
function draftPlan(state) {
  const sections = state.artifacts?.outline?.output?.sections;
  if (!Array.isArray(sections) || sections.length < 2 || sections.length > MAX_SECTIONS)
    return null;
  const plan = sections.map((section, index) => {
    const own = Number(section?.budget);
    return {
      index,
      total: sections.length,
      title: titleOf(section),
      budget: Number.isInteger(own) && own > 0 ? own : null,
    };
  });
  return plan.some((section) => section.budget) ? plan : null;
}

// 이 구간이 지킬 글자 수 범위 · 구간 한도를 전체 요구와 묶는다
// 구간마다 125%까지 따로 허용하면 합계가 전체 상한을 넘어 구성부터 전부 다시 쓰게 된다(실제 모델 실측: 780자 예산 → 917자)
// limit: 남은 구간이 예산대로 쓰여도 전체 상한을 넘지 않는 값 · floor: 마지막 구간에서 전체 하한을 채우는 값
function sectionBounds(state, plan, parts, section) {
  if (!section.budget) return {};
  const own = Math.round(section.budget * OVER_BUDGET);
  const length = requirements(state).length;
  if (!length) return { limit: own };
  const written = parts.reduce((sum, part) => sum + readerLength(part.text + JOINT), 0);
  const later = plan.slice(section.index + 1);
  const reserved = later.reduce((sum, next) => sum + (next.budget ?? 0) + JOINT.length, 0);
  const room = length.max === null ? own : length.max - written - reserved;
  const floor = later.length ? 0 : length.min - written;
  return {
    // 앞 구간이 한도 안이었으면 room은 예산 이상 · 구성 검사 전 저장분 등 예외에서만 예산으로 받친다
    limit: Math.max(section.budget, Math.min(own, room)),
    ...(floor > 0 ? { floor } : {}),
  };
}

export function currentSection(state) {
  const plan = draftPlan(state);
  if (!plan) return null;
  const parts = state.draftParts ?? [];
  const section = plan[parts.length];
  if (!section) return null;
  const retry = state.retry?.stage === "draft" && state.retry.index === section.index;
  return {
    ...section,
    ...sectionBounds(state, plan, parts, section),
    ...(retry ? { retryNote: state.retry.note, rejected: state.retry.rejected } : {}),
  };
}

// 구간 분량 위반 · 넘치면 줄이고 모자라면 채우는 지시 · 없으면 null
function sizeIssue(section, size) {
  if (section.limit && size > section.limit)
    return {
      note: `직전 작성 ${size}자 · 예산 ${section.budget}자 · 한도 ${section.limit}자. 약 ${size - section.budget}자를 예시·부연 삭제로 줄여 ${section.budget}자 안팎으로 다시 쓴다.`,
      error: `"${section.title}" 구간이 ${RETRY_LIMIT.draft}회 다시 써도 한도 ${section.limit}자를 넘음(${size}자).`,
    };
  if (section.floor && size < section.floor)
    return {
      note: `직전 작성 ${size}자 · 글 전체 분량을 채우려면 이 구간이 ${section.floor}자 이상이어야 한다. 약 ${section.floor - size}자를 구간 카드의 사례 장면과 keyPoint 풀이로 채워 다시 쓴다.`,
      error: `"${section.title}" 구간이 ${RETRY_LIMIT.draft}회 다시 써도 ${section.floor}자에 못 미침(${size}자).`,
    };
  return null;
}

// 원고는 글 제목 줄로 시작해야 한다(구간별 작성에서는 도입부가 실리는 첫 구간) · 형식 대조만
// 빠지면 제목과 도입부를 잃은 원고가 다음 단계로 넘어간다(구성 재작성 뒤 실측)
function leadIssue(state, text) {
  const title = state.artifacts?.outline?.output?.title?.trim();
  const line = (value) => value.replace(/\s+/g, " ").trim();
  const first = line(text.trimStart().split("\n", 1)[0]);
  const expected = title ? line(`# ${title}`) : null;
  if (expected ? first === expected : /^# \S/.test(first)) return null;
  return {
    note: `원고는 '${expected ?? "# 제목"}' 줄로 시작하고, 이어서 도입부를 쓴 뒤 첫 소제목으로 들어간다.`,
    error: `초고가 ${RETRY_LIMIT.draft}회 다시 써도 글 제목 줄로 시작하지 않음.`,
  };
}

// 한 번에 쓴 초고 수용 · 형식이 어긋나면 거부(다시 또는 실패) 후 null
export function acceptWhole(state, output) {
  const issue = leadIssue(state, output.text);
  if (issue) {
    reject(state, "draft", { index: 0, rejected: output.text, ...issue });
    return null;
  }
  if (state.retry?.stage === "draft") delete state.retry;
  return output;
}

// 구간 결과 수용 · 예산을 크게 넘거나 형식이 어긋나면 거부(다시 또는 실패) · 완료 시 전체 초고 반환
export function acceptPart(state, output) {
  const section = currentSection(state);
  const size = readerLength(output.text);
  const issue =
    (section.index === 0 ? leadIssue(state, output.text) : null) ?? sizeIssue(section, size);
  if (issue) {
    reject(state, "draft", { index: section.index, rejected: output.text, ...issue });
    return null;
  }
  delete state.retry;
  state.draftParts = [
    ...(state.draftParts ?? []),
    { text: output.text.trim(), summary: output.changeSummary },
  ];
  if (state.draftParts.length < section.total) return null;
  const draft = {
    text: state.draftParts.map((p) => p.text).join(JOINT),
    changeSummary: state.draftParts.map((p) => p.summary).join(" "),
  };
  delete state.draftParts;
  return draft;
}

// 이전 초고에서 같은 순서의 구간 · 구간 수가 같을 때만 기준본으로 사용
// 첫 구간은 제목·도입(lead)과 함께 쓰이므로 lead를 붙여 준다 · 첫 구간에 소제목이 없던 이전 초고는 lead가 곧 첫 구간
export function previousPart(previousText, index, total) {
  if (typeof previousText !== "string") return undefined;
  const { lead, sections } = splitArticle(previousText);
  const parts =
    sections.length === total ? [lead + sections[0], ...sections.slice(1)] : [lead, ...sections];
  return parts.length === total ? parts[index].trimEnd() : undefined;
}
