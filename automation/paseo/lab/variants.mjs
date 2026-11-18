// 연구소 변형 목록 · 비교할 조건 하나가 항목 하나 · 새 가설은 여기에 더하고 실행 기록의 variant로 가리킨다(LAB-001)
// shortcut: 변형은 기록의 ref(코드 기준)로만 구분하고 지시문을 변형별로 갈아 끼우지는 않음, 같은 코드에서 A·B를 동시에 돌릴 필요가 생기면 지시문 조립에 변형 주입 추가
/** @type {import("zod").infer<typeof import("../../contracts/lab.mjs").labSchema>["variants"]} */
export const LAB_VARIANTS = [
  {
    id: "baseline",
    label: "현재",
    hypothesis: "2026-11-18 기준 위치 제안·생성 지시문(ADR-0022·0023). 비교의 기준이다.",
    changes: [],
  },
  {
    id: "res010",
    label: "A · RES-010 원칙",
    hypothesis:
      "후보마다 없으면 놓치는 것·관계 종류·요소 대응표를 쓰게 하면 f1 같은 불필요한 후보가 빠지고 f3의 '모두 갖춰야'가 형태로 보인다.",
    changes: [
      "위치 제안에 without·relation·mapping 요구",
      "대응 없는 요소 제거·라벨 인접",
      "결여는 빠진 상태와 대비",
    ],
  },
];
