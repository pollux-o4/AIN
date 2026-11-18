// 편집 메모: 사람 피드백을 의도·수준·우선순위·살릴 것·합격 기준으로 번역 · ADR-0008
import { routeOutputExample } from "../../contracts/ai-output.mjs";

export const routeSpec = () => ({
  task: "편집장으로서 사람의 피드백을 수정 해석(brief)으로 정리한다. 뒤이은 단계(구성·초고·검토)는 이 수정 해석을 공통 기준으로 따른다.",
  steps: [
    "피드백 문구만 따로 떼어 보지 말고, 현재 적용되는 요구사항(requirements), 원래 글감(idea), 직전 review findings, draftMetrics, 작업 이력을 함께 살펴 독자 목적에 비추어 문제의 원인을 진단한다.",
    "level은 developmental(목적·독자·범위·구성 문제이거나 분량의 20%를 넘는 변경), line(문단·문장 흐름 수정), copy(표기·일관성 교정) 가운데 하나로 정한다.",
    "target에는 level에 맞는 가장 앞선 단계를 적는다. developmental이면 audience·value·outline 가운데 하나를, line이나 copy이면 draft를 적는다.",
    "priorities에는 고칠 사항을 중요도 순서대로 최대 5개 적고, preserve에는 현재 잘 쓰여 그대로 둘 사항을 적는다.",
    "requirements와 피드백을 대조하여, 피드백이 요구사항을 새로 정하거나 바꾸면 requirementChanges에 op set으로, 기존 요구사항을 풀면(예: 분량 제한을 두지 않겠다는 지시) op lift로 적는다. quote에는 근거가 된 피드백 문장을 그대로 옮긴다. 바뀌지 않은 요구사항은 적지 않는다. 승인된 변경은 뒤이은 단계와 코드 검사에 적용된다.",
    "acceptance.criteria에는 다음 결과가 채워야 할 기준을 예/아니오로 가릴 수 있는 문장으로 적는다. requirements에 이미 들어 있는 값(분량 등)은 criteria에 겹쳐 적지 않는다.",
    "자료나 피드백에 근거가 없는 임의 판단은 assumptions에 적어 사람이 검토하고 고칠 수 있게 한다.",
  ],
  criteria: [
    "reason이 수정 의도를 담은 1문장이고 피드백 문구를 그대로 되풀이하지 않았는가",
    "target이 level 규칙에 맞는 단계 이름인가",
    "criteria가 '더 좋게' 같은 막연한 말이 아니라 확인할 수 있는 문장인가",
    "피드백에 없는 요구를 임의로 보태지 않았으며, 보탠 사항이 있다면 assumptions에 적었는가",
    "requirementChanges에 피드백에 실제로 드러난 요구 변경만 넣었고 quote가 피드백 문장 그대로인가",
    "만족·발행 여부를 판단하지 않았는가",
  ],
  example: routeOutputExample,
});
