// 편집 메모: 사람 피드백을 의도·수준·우선순위·살릴 것·합격 기준으로 번역 · ADR-0008
import { routeOutputExample } from "../../contracts/ai-output.mjs";

export const routeSpec = () => ({
  task: "편집장으로서 사람의 피드백을 편집 메모로 변환한다. 후속 단계(구성·초고·검토)는 이 메모를 공통 기준으로 따른다.",
  steps: [
    "피드백 문구만 단편적으로 해석하지 말고 현재 적용되는 요구사항(requirements), 원래 글감(idea), 직전 review findings, draftMetrics 및 작업 이력을 함께 검토하여 독자 목적 기준으로 문제의 원인을 진단한다.",
    "level을 developmental(목적·독자·범위·구성 문제 또는 분량의 20%를 초과하는 변경), line(문단·문장 흐름 수정), copy(표기·일관성 교정) 중에서 정한다.",
    "target에는 level에 해당하는 가장 앞선 단계를 기재한다. developmental인 경우에는 audience·value·outline 중 하나를, line 또는 copy인 경우에는 draft를 기재한다.",
    "priorities에는 수정할 사항을 중요도 순으로 최대 5개 기재하고, preserve에는 현재 적절히 작성되어 유지할 사항을 기재한다.",
    "requirements와 피드백을 대조하여, 피드백이 요구사항을 새로 설정하거나 변경하면 requirementChanges에 op set으로 기재하고, 기존 요구사항을 해제하면(예: 분량 제한을 두지 않겠다는 지시) op lift로 기재한다. quote에는 근거가 된 피드백 문장을 그대로 옮긴다. 변경되지 않은 요구사항은 기재하지 않는다. 승인된 변경 사항은 이후 단계와 코드 검사에 적용된다.",
    "acceptance.criteria에는 다음 결과가 충족해야 할 기준을 예/아니오로 확인할 수 있는 문장으로 기재한다. requirements에 이미 포함된 값(분량 등)은 criteria에 중복 기재하지 않는다.",
    "자료나 피드백의 근거 없이 임의로 판단한 사항은 assumptions에 기재하여 사람이 검토하고 수정할 수 있도록 한다.",
  ],
  criteria: [
    "reason이 수정 의도를 담은 1문장이며 피드백 문구를 단순 반복하지 않았는가",
    "target이 level 규칙에 맞는 단계 이름인가",
    "criteria가 '더 좋게' 같은 형용사가 아니라 확인 가능한 문장인가",
    "피드백에 없는 요구를 임의로 추가하지 않았으며, 추가한 사항이 있다면 assumptions에 기재하였는가",
    "requirementChanges에 피드백에 실제로 명시된 요구 변경만 포함하였고 quote가 피드백 문장 그대로인가",
    "만족·발행 여부를 판단하지 않았는가",
  ],
  example: routeOutputExample,
});
