import { READER_LEVELS, sectionMode, WRITING_MODES } from "../contracts/writing-modes.mjs";

// RES-004 장르 경계 · RES-005 생성·검토 규칙. 각 묶음은 해당 mode 구간에만 적용한다.
export const BASE = {
  draft: [
    "[공통] 핵심·조건·근거·목소리를 보존하고 군더더기를 덜어낸다.",
    "[공통] 확인되지 않은 중요도·출제·수치는 확인되지 않음으로 명시한다.",
    "[구간 적용] mode별 규칙은 해당 구간에만 적용한다. explain 설계 카드를 다른 mode에 강제하지 않는다.",
  ],
  review: [
    "[구간 적용] 해당 구간의 mode 규칙만 검토한다. explain 설계 카드를 다른 mode의 평가 기준으로 쓰지 않는다.",
    "findings에 해당 원칙 ID(P1~P6)·구간·문제 표현·이유를 명시한다.",
    "preservationCheck에 핵심을 독자 말로 3문장 재진술(paraphrase)하고 원문과 불일치를 표시한다. AI 대리 지표를 실제 독자 검증으로 주장하지 않는다.",
  ],
};

export const MODE_RULES = {
  explain: {
    draft: [
      "[explain P2] 도입에 정의 1문장·읽고 할 수 있는 일·다룰 개념을 제시한다.",
      "[explain P4] 비유는 outline.analogySystem 하나만 사용하고 한계를 밝힌다. 새 비유를 추가하지 않는다.",
      "[explain P3·P4] 구간마다 개념 하나, 의존 순서대로 정의→비유 대응→이유→따라가는 예제를 쓴다. 숙련 독자는 예제를 생략할 수 있다.",
      "[explain P5] audience.misconceptions는 직접 반박하고 homonyms는 이름만 같고 대상이 다름을 밝힌다.",
      "[explain P1·P2] 전문어 첫 등장 풀이·1대상 1이름을 지키고 소제목·캡션은 결론 문장으로 쓴다.",
      "[explain P1·P6] optional 구간은 본문 흐름 밖 더 알아보기로, checkQuestion은 본문만으로 답할 수 있게 쓴다.",
    ],
    review: [
      "[explain P1·P2] 독자 수준·용어 풀이·동일 대상 이름·도입 지도·결론형 소제목을 확인한다.",
      "[explain P3·P4] 구간당 한 개념·의존 순서·단일 비유의 대응과 한계·예제를 설계 카드와 대조한다. 숙련 독자의 예제 생략은 허용한다.",
      "[explain P5·P6] 오해 반박·동음 개념 구분·본문으로 답할 수 있는 확인 질문을 확인한다.",
    ],
  },
  procedure: {
    draft: [
      "[procedure P2·P3] 지도를 먼저 주고 한 단계에 한 행동을 쓴다.",
      "[procedure P5·P6] 함정 경고·확인 방법을 제공한다. 비유 체계·캐릭터는 가져오지 않는다.",
    ],
    review: [
      "[procedure P2·P3·P5·P6] 지도·단계별 한 행동·함정 경고·확인 방법을 검토한다. 비유 체계·캐릭터를 요구하지 않는다.",
    ],
  },
  argue: {
    draft: [
      "[argue P2·P5] 결론 먼저·근거 묶음·예상 반론을 구성한다. 수준 배지·연습 문제는 가져오지 않는다.",
    ],
    review: [
      "[argue P2·P5] 결론·근거 묶음·예상 반론을 검토한다. 수준 배지·연습 문제를 요구하지 않는다.",
    ],
  },
  narrate: {
    draft: [
      "[narrate P1·P4] 구체 장면·군더더기 제거·목소리 보존을 따른다. 정의→비유→이유 틀·표는 가져오지 않는다.",
    ],
    review: [
      "[narrate P1·P4] 구체 장면·불필요한 표현·목소리 보존을 검토한다. 정의→비유→이유 틀·표를 요구하지 않는다.",
    ],
  },
};

export const LEVEL_RULES = {
  beginner: ["[독자 P1] 입문: 사전지식 가정을 줄이고 낯선 용어·필수 전제를 충분히 풀이한다."],
  intermediate: ["[독자 P1] 중급: 기본 지식의 반복 풀이를 줄이고 새 개념·연결·오해에 집중한다."],
  expert: [
    "[독자 P1] 숙련: 풀이 밀도를 낮추고 추론 여지를 남긴다. concrete·walkthrough는 선택이다.",
  ],
};

export function resolveDirection(state) {
  const diagnose = state.artifacts?.diagnose?.output;
  const primaryMode = WRITING_MODES.includes(state.direction?.mode)
    ? state.direction.mode
    : diagnose?.primaryMode;
  const readerLevel = READER_LEVELS.includes(state.direction?.readerLevel)
    ? state.direction.readerLevel
    : diagnose?.readerLevel;
  const modes = new Set([
    primaryMode,
    ...(state.artifacts?.outline?.output?.sections ?? []).map(sectionMode),
  ]);
  return {
    modes: WRITING_MODES.filter((mode) => modes.has(mode)),
    readerLevel: READER_LEVELS.includes(readerLevel) ? readerLevel : null,
  };
}

export function seasoningRules(stage, direction) {
  if (stage !== "draft" && stage !== "review") return [];
  return [
    ...BASE[stage],
    ...direction.modes.flatMap((mode) => MODE_RULES[mode][stage]),
    ...(LEVEL_RULES[direction.readerLevel] ?? []),
  ];
}
