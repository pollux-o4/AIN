// 검증: RES-005 코드 지표
import assert from "node:assert/strict";
import test from "node:test";
import { draftMetrics } from "../metrics.mjs";

const text = `# 제목

## 모놀리스는 한 번에 배포한다
모놀리스는 하나의 배포 단위다. 주문과 결제가 같은 프로세스에서 돈다.

| 표 | 값 |
| --- | --- |

## MSA는 따로 배포한다
서비스 메시가 통신을 맡는다. 쿠버네티스(컨테이너 운영 도구)가 배포를 맡는다.`;

test("문장·문단·구간 길이와 소제목을 코드로 센다", () => {
  const m = draftMetrics(text);
  assert.equal(m.characterCount, undefined, "분량 원천은 readerLength 하나");
  assert.equal(m.headingCount, 2);
  assert.ok(m.sentenceLength.median > 10 && m.sentenceLength.p90 >= m.sentenceLength.median);
  assert.ok(m.longestParagraph > 0 && m.longestSection > m.longestParagraph);
});

test("목록은 항목 단위로 재서 참고 문헌이 긴 문단으로 잡히지 않는다", () => {
  const list = Array.from(
    { length: 8 },
    (_, i) => `* 출처 ${i}: https://example.com/${"a".repeat(60)}`,
  ).join("\n");
  assert.ok(draftMetrics(`## 참고\n${list}`).longestParagraph < 100);
});

// 검증: RES-007 S 지표 · ADR-0013
const card = {
  title: "목록이 실수를 줄인다",
  mode: "narrate",
  keyPoint: "적으면 덜 잊는다",
  hook: "왜 늘 하나씩 빠뜨릴까요?",
  cases: ["가상의 예: 나는 두부를 빼먹었다."],
  underline: "기억이 아니라 종이가 장을 봅니다.",
  principleLine: "가기 전에 적으세요.",
};
const story = `# 장보기 목록 만드는 법

지난 주말 나는 마트에서 두부를 빼먹었습니다.

## 목록이 실수를 줄인다

왜 늘 하나씩 빠뜨릴까요? 나는 두부를 빼먹었다.

**기억이 아니라 종이가 장을 봅니다.**

가기 전에 적으세요.

### 한눈에 정리

- 가기 전에 적으세요.`;

test("S7: 질문·굵게·긴 문단을 구간별로 센다", () => {
  const m = draftMetrics(story);
  assert.deepEqual(m.sections, [{ questions: 1, bold: 1, longParagraphs: 0 }]);
  assert.equal(m.cardTransfer, undefined, "구성 카드가 없으면 대조하지 않음");
});

test("ADR-0013: 구성 카드의 칸이 초고에 글자 그대로 옮겨졌는지 대조한다", () => {
  const outline = { title: "장보기 목록 만드는 법", sections: [card] };
  assert.deepEqual(draftMetrics(story, { outline }).cardTransfer, {
    titleMatches: true,
    missingHooks: [],
    missingUnderlines: [],
    missingPrincipleLines: [],
    notInSummary: [],
  });
  const loose = story.replace("- 가기 전에 적으세요.", "- 미리 적자.").replace("# 장보기", "# 장");
  assert.deepEqual(draftMetrics(loose, { outline }).cardTransfer, {
    titleMatches: false,
    missingHooks: [],
    missingUnderlines: [],
    missingPrincipleLines: [],
    notInSummary: [card.title],
  });
  // 약속 문장은 글머리(첫 소제목 앞)에 그대로 실려야 한다
  const lead = { promise: "지난 주말 나는 마트에서 두부를 빼먹었습니다." };
  assert.equal(draftMetrics(story, { outline, value: lead }).cardTransfer.promiseInLead, true);
  const body = { promise: "기억이 아니라 종이가 장을 봅니다." };
  assert.equal(draftMetrics(story, { outline, value: body }).cardTransfer.promiseInLead, false);
  assert.deepEqual(draftMetrics(story, { outline }).missingHeadings, []);
  assert.deepEqual(
    draftMetrics(story.replace("## 목록이 실수를 줄인다\n", ""), { outline }).missingHeadings,
    [card.title],
    "구간이 구성의 소제목으로 시작하지 않으면 후보",
  );
  // 따라 하기 구간과 칸 없는 이전 구성은 대조 대상이 아님
  const procedure = { sections: [{ ...card, mode: "procedure" }, "옛 구간"] };
  assert.equal(draftMetrics(story, { outline: procedure }).cardTransfer, undefined);
});

// 검증: ADR-0014 소제목 나무 · 하위 마디 대조와 나무 모양 세기
test("ADR-0014: 하위 마디 소제목을 같은 단계로 대조하고 나무 모양을 센다", () => {
  const outline = {
    sections: [
      {
        title: "생각 방식",
        subsections: [
          { title: "전부 해 보기", subsections: [{ title: "브루트 포스" }, { title: "백트래킹" }] },
          { title: "쪼개서 풀기" },
        ],
      },
    ],
  };
  const text = `# 지도

도입

## 생각 방식

### 전부 해 보기

#### 브루트 포스

#### 백트래킹

### 쪼개서 풀기

## 한눈에 정리

- 줄`;
  const m = draftMetrics(text, { outline });
  assert.deepEqual(m.missingHeadings, []);
  assert.deepEqual(m.headingTree, {
    depth: 4,
    skippedLevels: 0,
    singleChildren: 0,
    maxSiblings: 2,
  });
  const flat = text
    .replace("#### 백트래킹", "### 백트래킹")
    .replace("### 쪼개서 풀기", "#### 쪼개서 풀기");
  const bad = draftMetrics(flat, { outline });
  assert.deepEqual(
    bad.missingHeadings,
    ["백트래킹", "쪼개서 풀기"],
    "단계가 다르면 실리지 않은 것",
  );
  assert.equal(bad.headingTree.singleChildren, 2);
  assert.equal(draftMetrics("# t\n\n## a\n\n#### b").headingTree.skippedLevels, 1);
});
