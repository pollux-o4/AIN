// 연구소 변형 · 한 실험은 변수 하나만 바꾼다 · 이번 변수: 그릴 대상을 정하는 방식(대상 정책)
// policy.plan은 위치 제안의 analogy 지시, policy.check는 위치 제안의 analogy 점검, policy.draw는 생성 층의 대상 지시 · 지시문 나머지는 모든 변형이 같다(LAB-001)
// 실행 중 변형 선택은 AIN_LAB_VARIANT(비우면 baseline) · 기록의 variant와 같은 id를 쓴다
const SAME_DRAW_TAIL =
  "개념의 각 요소가 대상의 실제 부품·상태에 대응하고, 개념 사이의 관계(순서·조건·대비)가 부품 사이의 관계로 그대로 성립하도록 구성한다.";

/** @type {(import("zod").infer<typeof import("../../contracts/lab.mjs").labSchema>["variants"][number] & { policy: { plan: string, check: string, draw: string } })[]} */
export const LAB_VARIANTS = [
  {
    id: "baseline",
    label: "현재",
    hypothesis:
      "기준. 문단에 비유가 없으면 본문 개념을 그대로 그린다. f3에서 이름 없는 추상 부품(조건 칸·판)이 나왔다.",
    changes: [],
    policy: {
      plan: "analogy에는 해당 문단이 쓴 비유 대상을 본문 표현 그대로 적고, 비유가 없으면 생략한다.",
      check: "analogy가 해당 문단이 쓴 비유 대상만 담았는가",
      draw: "그릴 대상은 analogy(본문 비유 대상)로 하며, analogy가 없으면 본문 개념을 그대로 그린다. 본문에 없는 다른 사물로 바꾸지 않는다. 대상의 구조를 나누어 개념의 각 요소가 실제 부품에 대응하도록 구성한다.",
    },
  },
  {
    id: "metaphor",
    label: "현실 장면 비유",
    hypothesis:
      "문단의 논리를 먼저 분석하고 그 논리가 같은 방식으로 작동하는 현실 장면을 비유로 삼으면, 문단에 비유가 없어도 논리가 이름 있는 장면으로 보인다(사용자 가설).",
    changes: [
      "문단 분석: 주장·전개 순서·개념 사이 관계·성립과 실패 조건",
      "같은 관계로 작동하는 현실 장면 후보 3개 → 개념·관계·실패가 장면에 1:1로 옮겨지는지 확인 → 하나 선택",
      "본문 밖 장면 허용, 겉 속성으로 본문에 없는 사실 암시 금지",
    ],
    policy: {
      plan: "analogy에는 그릴 현실 장면을 적는다. 장면은 다음 순서로 정한다. 첫째, 해당 문단과 앞뒤 문단에서 독자에게 납득시키려는 주장, 주장을 펼치는 순서, 개념 사이의 관계(순서·조건·대비·인과·반복), 그 관계가 성립하는 경우와 깨지는 경우를 정리한다. 둘째, 같은 관계로 작동하는 현실 장면을 세 개 찾는다. 장면은 본문 개념을 일상어로 다시 묘사한 것이 아니라, 다른 영역에서 같은 관계로 일어나는 일이어야 한다(예: 전류를 설명할 때 수도관에 흐르는 물). 장면은 독자가 직접 겪어 보았거나 쉽게 떠올릴 수 있어야 하며, 문단에 비유가 있으면 그 비유를 첫 후보로 둔다. 셋째, 후보마다 개념 하나가 장면의 사물·행동·상태 하나에 대응하는지, 개념 사이의 관계와 깨지는 경우가 장면 안에서도 같은 방식으로 일어나는지 확인하고, 대응이 가장 온전한 장면 하나를 고른다. 겉모습이나 분위기만 닮은 장면은 고르지 않는다. 고른 장면은 analogy에 이름으로 짧게 적고(예: 자판기에서 거스름돈 받기), 구체적인 모습은 scene에 적는다.",
      check:
        "analogy 장면에서 개념·관계·깨지는 경우가 사물·행동·상태로 하나씩 옮겨지며, 본문 밖 장면이라면 그 겉 속성이 본문에 없는 사실을 암시하지 않는가",
      draw: `그릴 대상은 analogy에 적힌 현실 장면으로 하며, 독자가 이름 하나로 부를 수 있는 실제 사물·사람·행동으로 그린다. 장면이 본문 밖 대상이어도 그대로 그리되, 겉 속성으로 본문에 없는 사실을 암시하지 않는다. ${SAME_DRAW_TAIL}`,
    },
  },
];

/** 현재 실행의 대상 정책 · 알 수 없는 변형은 조용히 기준으로 바꾸지 않고 멈춘다 */
export function objectPolicy(id = process.env.AIN_LAB_VARIANT || "baseline") {
  const variant = LAB_VARIANTS.find((entry) => entry.id === id);
  if (!variant)
    throw new Error(`Unknown lab variant: ${id} (${LAB_VARIANTS.map((v) => v.id).join("|")})`);
  return variant.policy;
}
