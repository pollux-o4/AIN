import { slotCheck } from "../contracts/slot-rules.mjs";
import {
  READER_LEVELS,
  sectionMode,
  usesStoryCard,
  WRITING_MODES,
} from "../contracts/writing-modes.mjs";
import { requirementValue } from "../editorial/domain/index.mjs";

// 글쓰기 규칙의 단일 정의: 이해(P1~P6, RES-002) 위에 끌기·남기기·보이기(S1~S10, RES-007)와 도입부 역할(L1·L2, RES-008)을 얹음
// RES-004 장르 경계 · RES-005 생성·검토 규칙. 각 묶음은 해당 mode 구간에만 적용한다.
// 과장어 예시: 초고 규칙·항목 통과 기준이 같은 목록을 보여 준다 · 과장인지는 검토가 문맥으로 판단(코드가 세지 않음)
// shortcut: 출처 없는 최소 예시(RES-007 미결정), 독자 불만 사례가 쌓이면 근거 있는 목록으로 교체
const HYPE_WORDS = [
  "최고의",
  "반드시",
  "무조건",
  "절대",
  "완벽",
  "누구나",
  "단연",
  "놀라운",
  "혁신적",
  "엄청난",
];
// 프롬프트에 싣는 과장어 안내 · 약속하는 말(제목·약속·마무리 문장)에 쓰지 않는다
export const HYPE_HINT = `과장어(${HYPE_WORDS.join("·")})`;

// 말투·시점은 글 전체에 하나 · 진단이 정하고(diagnose.preserveVoice) 독자에게 실릴 항목과 초고가 모두 그것을 따른다
// 항목마다 종결어미를 따로 정하면 그대로 옮긴 초고에서 합니다체와 한다체가 섞인다(실제 모델 실측)
export const VOICE = {
  decide:
    "preserveVoice에는 글 전체에 쓸 문체(종결어미)와 시점을 하나로 정해 적는다. 글감이나 원문에 정해진 바가 있으면 그 기준을 따르고, 없으면 '합니다체·독자에게 직접'으로 정한다.",
  slot: (names) =>
    `${names} 항목은 본문에 실리므로, diagnose.preserveVoice에서 정한 문체(종결어미)와 시점으로 적는다.`,
  draft:
    "[문체 통일] 글 전체의 종결어미와 시점을 diagnose.preserveVoice에 정해진 하나로 통일한다. 제목·소제목·끝 정리 목록에도 똑같이 적용한다.",
  check: "문체(종결어미)와 시점이 글 전체에서 하나로 통일되어 있는가",
};

// 도입부: 형식 대신 역할 두 가지(L1·L2)를 정하고 여는 방식은 작성 AI가 고른다 · RES-008, ADR-0021
// 같은 기법도 글마다 효과의 방향이 달라(RES-008 출처 4) 특정 형식을 고정하지 않는다
// 초고 지시와 검토 질문이 같은 역할 문장을 읽는다(한 곳만 고치면 둘이 어긋나지 않게)
const LEAD_ROLE = {
  L1: {
    draft: "독자가 처한 상황이나 고민을 짚어 독자가 이 글을 자기 일로 받아들이게 한다",
    check: "독자가 처한 상황이나 고민을 짚어 독자가 이 글을 자기 일로 받아들이게 하는가",
  },
  L2: {
    draft: "글을 읽고 나서 할 수 있게 되는 일을 쉬운 말로 밝힌다",
    check: "글을 읽고 나서 할 수 있게 되는 일을 쉬운 말로 밝히는가",
  },
};
const LEAD_OPENINGS =
  "독자의 경험을 묻기, 독자가 처한 조건을 짚기, 독자나 인물이 겪는 장면을 보여 주기, 흔한 생각과 다른 사실을 먼저 밝히기";
export const LEAD = {
  draft: [
    `도입부는 두 가지 일을 한다. 첫째, ${LEAD_ROLE.L1.draft}(L1). 둘째, ${LEAD_ROLE.L2.draft}(L2).`,
    `여는 방식은 ${LEAD_OPENINGS} 가운데에서 독자와 주제에 맞는 것을 고르거나 섞는다. 정의나 배경 설명으로 시작하지 않는다.`,
    "audience.scene과 value.promise는 재료로 쓰되, 뜻을 지키는 범위에서 문맥에 맞게 고쳐 쓴다. 구간이 셋 이상이면 이 글이 다룰 내용의 순서를 한 문장으로 안내한다. 도입부에 audience.unknownTerms의 용어를 쓸 때는 그 자리에서 바로 풀이한다.",
    "changeSummary에는 고른 여는 방식과 그 이유를 한 줄로 적는다.",
  ].join(" "),
  check: {
    S1: `도입부(첫 소제목 앞)가 ${LEAD_ROLE.L2.check}(L2)`,
    S2: `도입부의 첫 세 문장이 ${LEAD_ROLE.L1.check}(L1). 여는 방식이 주제와 독자 수준에 맞고 상투적인 문구로 흐르지 않았는가`,
  },
};
// 자연스러운 한국어: 글의 목적(독자가 머리를 덜 쓰고 바로 알아듣는다)에서 나온 공통 기준 · 구성 항목과 본문에 함께 적용
export const NATURAL_KOREAN =
  "[자연스러운 한국어] 독자가 소리 내어 읽었을 때 자연스러운 한국어로 쓴다. 번역투, 정해진 문형에 내용을 끼워 맞춘 문장, 독자가 한 번 더 옮겨 생각해야 하는 추상적 비유를 쓰지 않는다. 비유는 독자가 바로 떠올리는 일상 사물이 개념과 직접 대응할 때만 쓴다.";
export const BASE = {
  draft: [
    "[공통] 핵심 내용·조건·근거·원문의 목소리를 지키고 군더더기 수식을 뺀다.",
    "[공통] 사실 여부가 확인되지 않은 중요도·출제 정보·수치는 확인되지 않았음을 명확히 밝힌다.",
    "[구간 적용] 각 mode별 규칙은 해당 mode의 구간에만 적용하며, explain 설계 카드를 다른 mode 구간에 강제하지 않는다.",
    "[S4 쉬운 표현] 한 문장에 하나의 생각만 담는다. 독자가 알기 어려운 용어는 처음 나올 때 괄호나 한 문장으로 풀이하고, 같은 대상은 글 끝까지 같은 이름으로 부른다.",
    NATURAL_KOREAN,
    VOICE.draft,
    "[S5 대화체] 독자에게 직접 말하듯 쓰되, 나무라거나 가르치려 드는 표현 대신 권유하는 표현을 쓴다.",
    "[S9 구조화] 문단은 3~6문장으로 쓴다(다만 강조를 위한 한 줄 문단은 허용한다). 목록은 대등한 항목을 나열할 때만 쓴다. 모든 구간은 outline의 title을 그대로 쓴 소제목으로 시작하고, 하위 항목은 subsections의 title을 그대로 쓴 한 단계 아래의 소제목으로 시작한다.",
    `[S10 정직] ${HYPE_HINT}로 효과를 과장하지 않는다. 지어낸 인물이나 사례는 처음 나오는 자리에서 가상임을 한 번만 짧게 밝히고, 그 뒤에는 되풀이하지 않는다. 독자에게 직접 묻거나 독자의 상황을 짚는 문장은 지어낸 사례가 아니므로 따로 밝히지 않는다. 가상 장면 속 숫자(개수·시간 등)는 장면 묘사에만 쓰고, 효과·비율·통계처럼 사실적 근거로 오해될 수 있는 주장에는 쓰지 않는다.`,
    "[본문 제외 사항] 자료에 근거가 없어 쓰지 못한 내용을 본문에 '자료에 나와 있지 않다'고 적지 않는다. 그 내용은 본문에서 빼고, 독자가 스스로 확인할 수 있는 방법이 있으면 그 방법을 안내한다.",
    "[퇴고] 초고를 쓴 뒤 전체를 처음부터 끝까지 읽으면서 빼도 뜻이 통하는 문장과 겹치는 표현을 덜어 낸다.",
  ],
  review: [
    "[구간 적용] 해당 구간의 mode 규칙만 검토한다. explain 설계 카드를 다른 mode의 평가 기준으로 적용하지 않는다.",
    "findings에 checks의 기준 ID·구간·문제 표현·이유를 명시한다.",
    "preservationCheck에는 핵심 내용을 독자의 언어로 3문장으로 재진술(paraphrase)하고 원문과 불일치하는 지점을 표시한다. AI 기반의 대리 지표를 실제 독자 검증 결과인 것처럼 주장하지 않는다.",
  ],
};

// 구간 카드 규칙: 카드를 쓰는 mode(procedure 제외) 구간이 하나라도 있을 때만
export const STORY_RULES = {
  draft: [
    "[S 구간 카드] procedure가 아닌 구간은 세 문단으로 짠다. 첫째 문단에는 hook(구간의 첫 문장)과 cases의 장면을, 둘째 문단에는 keyPoint 풀이와 underline(강조 문장, **굵게** 표기하며 해당 구간에서 굵게 처리는 이 한 곳에만 쓴다)을, 셋째 문단에는 principleLine(마무리 문장, 구간 마지막의 한 줄 문단)을 둔다. 다만 subsections가 있을 때는 셋째 문단인 principleLine을 하위 항목 안내 문단 뒤이자 첫 하위 소제목 앞에 두어 하위 항목으로 구간을 마무리한다(하위 항목 뒤에 두면 마지막 하위 항목의 일부로 읽히기 때문이다). 하위 항목 안의 대상 이름은 굵게 표기할 수 있다.",
    "[S 반복 금지] keyPoint 풀이는 장면이 보여 준 내용에서 한 걸음 나아가 그 이유나 실행 방법을 설명한다. 여는 질문(hook)·장면·강조 문장(underline)을 낱말만 바꾸어 다시 쓰지 않는다.",
    "[S 원문 유지] hook·underline·principleLine은 구간 카드에 적힌 문장을 글자 그대로 쓴다(시스템이 글자를 대조한다). 카드에 없는 사례나 핵심 원칙을 새로 넣지 않으며, 카드에서 해당 항목이 비어 있으면 그 요소는 뺀다.",
  ],
  review: [
    "[S 구간 카드] procedure 구간에는 S2·S3·S6·S7·S8 기준을 적용하지 않는다. 구간 카드의 각 항목이 초고에 반영되었는지는 draftMetrics.cardTransfer 값으로만 판단한다.",
  ],
};

// 검토 점검표(S1~S10): 예/아니오로 답하는 질문 · 괄호 안은 근거로 인용할 코드 측정값(세거나 글자 대조한 것만) · 괄호가 없으면 본문을 읽고 판단 · story는 구간 카드 구간 전용
export const CHECKS = [
  {
    id: "S1",
    ask: `${slotCheck("title", "글 제목")} ${LEAD.check.S1} (cardTransfer.titleMatches)`,
  },
  {
    id: "S2",
    ask: LEAD.check.S2,
  },
  {
    id: "S3",
    story: true,
    ask: "구간 첫머리에 내놓은 여는 질문(질문·주장)에 대한 답이 같은 구간 안에 들어 있는가 (cardTransfer.missingHooks)",
  },
  {
    id: "S4",
    ask: "한 문장에 하나의 생각만 담겨 있고, 독자가 알기 어려운 용어가 처음 나올 때 풀이되며, 소리 내어 읽었을 때 자연스러운 한국어인가(번역투·같은 문형 반복·한 번 더 옮겨 생각해야 하는 비유가 없는가) (sentenceLength)",
  },
  {
    id: "S5",
    ask: `독자에게 직접 말하는 어조를 지키고 나무라는 표현이 없으며 ${VOICE.check}`,
  },
  {
    id: "S6",
    story: true,
    ask: "구간마다 하나의 핵심 원칙에 사례 1~3개가 맞닿으며, 사례가 평가나 요약이 아니라 구체적 장면(행동과 눈에 보이는 결과)으로 제시되고, 같은 내용이 구간 안에서 되풀이되지 않는가",
  },
  {
    id: "S7",
    story: true,
    ask: "구간마다 굵게 표기한 강조 문장이 1개씩 있는가 (sections[].bold·cardTransfer.missingUnderlines)",
  },
  {
    id: "S8",
    story: true,
    ask: "각 구간이 마무리 문장으로 끝나고 끝 정리 목록에 그 문장들이 글자 그대로 모여 있는가 (cardTransfer.missingPrincipleLines·notInSummary)",
  },
  {
    id: "S9",
    ask: "모든 구간과 하위 항목이 구간 카드의 소제목으로 시작하고, 제목과 소제목만으로도 글의 전체 구조가 파악되며(같은 단계의 소제목끼리 같은 형태를 유지함), 계층 단계를 건너뛰거나 하위 항목이 하나뿐인 곳이 없고, 각 문단이 6문장을 넘지 않는가 (missingHeadings·headingTree·sections[].longParagraphs·longestParagraph)",
  },
  {
    id: "R",
    ask: "requirements의 요구사항(시스템이 검사하는 분량 제외: 서술 방식·독자 수준·어조·범위·금지 사항 등)을 모두 지켰는가",
  },
  {
    id: "S10",
    ask: "과장어를 쓰지 않았고, 지어낸 인물이나 사례가 있으면 처음 나온 자리에서 가상임을 한 번 밝혔으며, 자료에 없는 사실이나 출처가 들어가지 않았는가",
  },
];

export const MODE_RULES = {
  explain: {
    draft: [
      "[explain P2] 핵심 개념을 정의하는 1문장은 그 개념을 다루는 구간의 첫 사례 뒤에 둔다.",
      "[explain P4] 비유는 outline.analogySystem이 있을 때 그 하나만 쓰고 그 한계를 밝힌다. analogySystem이 없으면 비유 없이 직접 설명한다. 새 비유를 보태지 않는다.",
      "[explain P3·P4] 구간마다 하나의 개념만 다루며, 의존 순서에 따라 정의→비유 대응→이유→따라가는 예제 순서로 쓴다. 다만 숙련 독자 대상이면 예제를 뺄 수 있다.",
      "[explain P5] audience.misconceptions에 나온 오해는 직접 바로잡고, homonyms에 나온 동음이의 개념은 이름만 같을 뿐 대상이 다름을 밝힌다.",
      "[explain P1·P2] 전문 용어는 처음 나올 때 풀이하고, 같은 대상은 글 끝까지 같은 이름으로 부른다. 구간 소제목은 그 구간에서 독자가 얻을 답을 짧고 자연스러운 말로, 하위 소제목은 짧은 대상 이름으로, 캡션은 그림이 보여 주는 결론 문장으로 쓴다.",
      "[explain P1·P6] optional 구간은 핵심 흐름 밖의 심화 안내로 짜고, checkQuestion은 본문 내용만으로 답할 수 있게 쓴다.",
    ],
    review: [
      "[explain P1·P2] 독자 수준에 맞는지, 용어를 풀이했는지, 같은 대상의 이름이 일관되는지, 도입부에 전체 구조 안내가 있는지, 계층별 소제목 역할(구간: 그 구간의 답, 하위 항목: 짧은 대상 이름)을 지켰는지 확인한다.",
      "[explain P3·P4] 구간마다 개념을 하나만 다루는지, 의존 순서와 단일 비유의 대응·한계 및 예제가 설계 카드와 맞는지 대조한다. 다만 숙련 독자 대상일 때 예제를 뺀 것은 허용한다.",
      "[explain P5·P6] 오해를 바로잡았는지, 이름이 같은 다른 개념을 구분했는지, 본문만으로 답할 수 있는 확인 질문이 적절한지 확인한다.",
    ],
  },
  procedure: {
    draft: [
      "[procedure P2·P3] 전체 절차의 순서 개요를 먼저 내놓고, 각 단계는 번호 목록으로 쓴다. 번호 하나에는 행동 하나만 담고, 행동 뒤에는 그 결과로 화면이나 실제 작업 환경에서 보이는 변화를 적는다.",
      "[procedure P5·P6] 주의할 함정 경고와 결과 확인 방법을 함께 둔다. 비유 체계·캐릭터는 쓰지 않는다.",
    ],
    review: [
      "[procedure P2·P3·P5·P6] 순서 개요, 단계별 단일 행동, 함정 경고와 확인 방법이 들어 있는지 검토한다. 비유 체계·캐릭터는 요구하지 않는다.",
    ],
  },
  argue: {
    draft: [
      "[argue P2·P5] 결론을 먼저 내놓고 근거 묶음과 예상 반론을 차례로 짠다. 수준 배지·연습 문제는 쓰지 않는다.",
    ],
    review: [
      "[argue P2·P5] 결론, 근거 묶음, 예상 반론을 갖추었는지 검토한다. 수준 배지·연습 문제는 요구하지 않는다.",
    ],
  },
  narrate: {
    draft: [
      "[narrate P1·P4] 구체적 장면 묘사, 군더더기 수식 제거, 원문 목소리 보존 원칙을 따른다. 정의→비유→이유 틀·표는 쓰지 않는다.",
    ],
    review: [
      "[narrate P1·P4] 구체적 장면 묘사를 했는지, 불필요한 표현을 덜어 냈는지, 원문의 목소리를 지켰는지 검토한다. 정의→비유→이유 틀·표는 요구하지 않는다.",
    ],
  },
};

export const LEVEL_RULES = {
  beginner: [
    "[독자 P1] 입문 수준에서는 독자의 사전지식을 거의 가정하지 않고, 낯선 용어와 필수 전제를 충분히 풀이한다.",
  ],
  intermediate: [
    "[독자 P1] 중급 수준에서는 기본 지식의 반복 풀이를 줄이고 새 개념, 개념 사이의 연결, 오해 풀이에 집중한다.",
  ],
  expert: [
    "[독자 P1] 숙련 수준에서는 기초 풀이 비중을 낮추고 독자가 스스로 추론할 여지를 남긴다. concrete와 walkthrough는 선택 사항으로 둔다.",
  ],
};

export function resolveDirection(state) {
  const diagnose = state.artifacts?.diagnose?.output;
  // 요구사항 목록 값 우선 · 없으면 진단 판단 · ADR-0016
  const primaryMode = requirementValue(state, "mode") ?? diagnose?.primaryMode;
  const readerLevel = requirementValue(state, "readerLevel") ?? diagnose?.readerLevel;
  const modes = new Set([
    primaryMode,
    ...(state.artifacts?.outline?.output?.sections ?? []).map(sectionMode),
  ]);
  return {
    modes: WRITING_MODES.filter((mode) => modes.has(mode)),
    readerLevel: READER_LEVELS.includes(readerLevel) ? readerLevel : null,
  };
}

const usesStory = (direction) => direction.modes.some(usesStoryCard);

export function seasoningRules(stage, direction) {
  if (stage !== "draft" && stage !== "review") return [];
  return [
    ...BASE[stage],
    ...(usesStory(direction) ? STORY_RULES[stage] : []),
    ...direction.modes.flatMap((mode) => MODE_RULES[mode][stage]),
    ...(LEVEL_RULES[direction.readerLevel] ?? []),
  ];
}

// 이번 글에 적용할 점검 항목 · 구간 카드 구간이 없으면 story 항목 제외
export const reviewChecks = (direction) =>
  CHECKS.filter((check) => !check.story || usesStory(direction));
