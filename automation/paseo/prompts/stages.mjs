// 단계별 과업 정의: 이번 일 · 순서 · 통과 기준 · 새 단계는 여기에 항목 하나를 더한다 · ADR-0013
// 항목의 뜻은 contracts/ai-output(출력 예시로 실림), 문체·장르 규칙은 seasoning이 소유한다
import { draftEditExample, stageOutputExamples } from "../../contracts/ai-output.mjs";
import {
  sectionHeading,
  subsectionHeading,
  summaryHeading,
} from "../../contracts/article-structure.mjs";
import { slotCheck } from "../../contracts/slot-rules.mjs";
import {
  CARD_SPACE,
  MAX_CASES,
  READER_LEVELS,
  WRITING_MODES,
} from "../../contracts/writing-modes.mjs";
import { requirementValue } from "../../editorial/domain/index.mjs";
import {
  HYPE_HINT,
  LEAD,
  NATURAL_KOREAN,
  resolveDirection,
  reviewChecks,
  seasoningRules,
  VOICE,
} from "../seasoning.mjs";

// 요구사항 목록이 정한 서술 방식·독자 수준 · 없으면 진단이 판단 · ADR-0016
const chosen = (state, key) => requirementValue(state, key) ?? null;

const MODE_GUIDE =
  "explain(개념을 이해시킨다) | procedure(순서대로 따라 하게 한다) | argue(근거로 설득한다) | narrate(경험·사례를 들려준다)";
const LEVEL_GUIDE =
  "beginner(이 주제가 처음) | intermediate(기본 용어는 안다) | expert(실무 경험이 있다)";

/** @type {Record<string, (state: any, action: any) => {task: string, steps: string[], rules?: string[], criteria: string[], outputNotes?: string[]}>} */
const STAGE_SPECS = {
  diagnose: (state) => {
    const mode = chosen(state, "mode");
    const level = chosen(state, "readerLevel");
    return {
      task: "글감(idea)과 원문(source)을 읽고 글의 목적·독자·서술 방식·독자 수준을 결정한다. 이후 모든 단계는 이 결정을 따른다.",
      steps: [
        "idea에서 사용자가 원하는 결과를 파악한다. 어떤 주제의 글을 누구에게 어떤 조건(분량·시점·금지 사항 등)으로 써야 하는지 확인한다.",
        mode
          ? `requirements.mode ${mode}를 primaryMode로 그대로 반환한다.`
          : `requirements.mode가 없으면 ${MODE_GUIDE} 가운데 primaryMode를 판단한다. 독자가 글을 읽은 뒤 할 행동을 기준으로 고르되, 두 가지 이상이 해당하면 글에서 비중이 가장 큰 하나를 고른다.`,
        level
          ? `requirements.readerLevel ${level}를 readerLevel로 그대로 반환한다.`
          : `requirements.readerLevel이 없으면 ${LEVEL_GUIDE} 가운데 readerLevel을 판단한다. 다만 자료에 독자 수준을 가늠할 단서가 없으면 beginner로 정한다.`,
        "sectionModes에는 예상되는 각 구간의 서술 방식을 하나씩 적는다. 기본값은 primaryMode로 통일한다.",
        VOICE.decide,
        "idea에서 사용자가 밝힌 조건(분량·서술 방식·독자 수준·어조·범위·금지 사항 등) 가운데 requirements에 아직 없거나 기존 값과 다른 항목은 requirementChanges에 op set으로 적는다. quote에는 근거가 된 idea 문장을 그대로 옮긴다. 해당하는 조건이 없으면 빈 배열로 둔다.",
      ],
      criteria: [
        "purpose가 '독자가 …하게 한다' 형식의 1문장인가",
        "requirementChanges에 idea에 실제로 드러난 조건만 담았고 quote가 idea 문장 그대로인가",
        `primaryMode는 ${WRITING_MODES.join("|")}, readerLevel은 ${READER_LEVELS.join("|")} 중 하나인가`,
        "requirements와 idea의 모든 조건이 strategy에 빠짐없이 반영되었는가",
        "자료에 없는 독자 정보나 사실을 임의로 만들어 내지 않았는가",
      ],
    };
  },
  topic: () => ({
    task: "이 글에서 풀 핵심 문제 하나와 다룰 범위를 정하고 제목 후보 3개를 만든다.",
    steps: [
      "problem에는 독자가 겪는 문제를 독자가 실제로 쓸 만한 말로 1문장으로 적는다.",
      "scope에는 이 글에서 다룰 내용과 다루지 않을 내용을 구분해 적는다. 다만 idea에 분량 요구가 있으면 그 분량 안에 담을 수 있는 범위로 정한다.",
      "titleCandidates에는 제목 후보 3개를 약속형(읽으면 얻는 것), 궁금증형(질문이나 뜻밖의 사실), 경고형(피해야 할 실수) 순서로 적는다.",
    ],
    criteria: [
      "problem이 문제 하나만 다루고 있으며 두 문제를 '그리고' 등으로 잇지 않았는가",
      "제목 후보가 유형별로 1개씩 총 3개인가",
      `모든 제목이 공백 포함 40자 이내이고 독자가 모를 전문어와 ${HYPE_HINT}가 없는가`,
      "제목이 약속한 내용을 scope 범위 안에서 충족할 수 있는가",
    ],
  }),
  audience: () => ({
    task: "독자 카드를 정리한다. 구성 단계와 초고 단계는 설명 수준과 도입부 재료를 이 카드에서 참고한다.",
    steps: [
      "reader와 intent는 diagnose 단계의 판단과 어긋나지 않게 적는다.",
      "readerTask에는 독자가 글을 읽은 뒤 할 수 있게 될 일을 1문장으로 적는다.",
      "knows·unknownTerms·misconceptions·homonyms에는 글감과 자료에서 근거를 찾을 수 있는 항목만 적고, 해당하는 내용이 없으면 빈 배열로 둔다.",
      "scene에는 독자가 이 문제를 겪는 구체적 상황 하나를 2~3문장으로 적는다. 독자가 무엇을 하려다 어디에서 막히는지가 드러나게 쓴다. 초고는 이 상황을 도입부의 재료로 쓴다. 자료에 등장인물이 있으면 그 인물의 상황을 쓰고, 없으면 대상 독자 자신의 상황으로 적는다.",
      VOICE.slot("scene"),
    ],
    criteria: [
      "readerTask가 '…할 수 있다'로 끝나는 1문장인가",
      "scene에 독자가 하려던 일과 막히는 지점이 구체적으로 드러나 있는가",
      "scene이 자료에 근거하거나 오늘날의 대상 독자가 실제로 겪을 수 있는 상황인가",
      "근거가 없는 항목을 채우려고 내용을 지어내지 않았는가",
    ],
  }),
  value: () => ({
    task: "독자에게 줄 결과와 약속을 정하고, 그 목적에 필요하지 않은 내용은 범위에서 뺀다.",
    steps: [
      "outcome에는 audience.readerTask를 이룬 결과를 1문장으로 적는다.",
      "promise에는 같은 내용을 독자에게 건네는 약속 문장 1개로 적는다. 초고는 이 문장의 뜻을 살려 도입부에 싣는다.",
      VOICE.slot("promise"),
      "preserve에는 글감과 원문에서 꼭 지켜야 할 조건·사실·목소리를 적는다.",
      "readerTask를 이루는 데 필요 없는 내용은 excluded에 적는다. 다만 requirements.length가 지정되어 있으면 다룰 범위를 그 분량에 맞게 조절한다.",
    ],
    criteria: [
      "promise가 '…할 수 있다'는 뜻으로 끝나는 1문장이고 readerTask와 같은 과제를 가리키는가",
      `promise에 ${HYPE_HINT}가 없고 이 글의 범위 안에서 지킬 수 있는가`,
      "사용자가 idea에 밝힌 조건이 preserve에 모두 들어 있는가",
      "excluded의 항목이 preserve의 항목과 겹치거나 어긋나지 않는가",
    ],
  }),
  research: () => ({
    task: "주어진 자료에서 글의 근거가 될 사실과 원칙을 보여 줄 사례 후보를 고른다.",
    steps: [
      "source와 idea에서 글의 근거로 삼을 사실을 골라 evidence에 claim과 출처(url)로 적는다. 이때 자료의 어느 문장에서 나왔는지 짚을 수 있는 사실만 적는다.",
      "글을 쓰는 데 필요하지만 자료만으로 확인되지 않는 내용은 uncertainties에 적는다.",
      "cases에는 사례 후보를 3~6개 적는다. 사례는 교훈을 풀이하는 요약이 아니라 구체적 장면이어야 하며, 주인공이 언제·어디서 무엇을 했고 눈에 보이는 결과(사물·횟수·시간 등)가 어땠는지를 담아야 한다.",
      "자료에 들어 있는 사례는 origin을 source로 적는다. 자료에 없어 새로 짠 가상 사례는 origin을 hypothetical로 적는다. 가상 사례가 여럿이면 한 인물이 이어서 겪는 장면으로 쓴다(사례마다 새 인물을 만들지 않는다).",
    ],
    criteria: [
      "모든 claim이 자료의 문장으로 확인되며 기억이나 추측으로 쓰지 않았는가",
      "새로 짠 가상 사례의 origin이 모두 hypothetical이고 실존 인물·기관·통계를 지어내지 않았는가(장면 속 수치는 상황 묘사에만 쓰고 효과나 비율의 근거로 내세우지 않았는가)",
      "사례마다 주인공의 구체적 행동 하나와 눈에 보이는 결과가 들어 있으며, '위험해졌다·편해졌다' 같은 추상적 평가만 쓰지 않았는가",
      "사례에 교훈이나 원칙을 풀이하는 문장이 섞이지 않았는가",
      "가상 사례가 여럿이면 모두 같은 인물이 겪는 일인가",
      "사례가 오늘날의 독자가 실제로 겪을 수 있는 상황인가",
      "evidence와 uncertainties 중 적어도 하나는 비어 있지 않은가",
    ],
  }),
  outline: (state) => ({
    task: "구간별 구간 카드를 작성한다. 작성 담당자는 구간 카드의 각 항목을 문장으로 옮겨 쓰기만 하므로, 글의 완성도와 수준은 이 카드에서 결정된다.",
    steps: [
      "title에는 topic.titleCandidates 가운데 value.promise를 가장 잘 전하는 제목 하나를 글자 그대로 옮겨 적는다. 다만 알맞은 후보가 없으면 약속형 제목을 새로 만든다.",
      `글의 구간을 나눈 뒤, 구간마다 하나의 핵심 원칙(keyPoint)을 정하여 title·mode·keyPoint를 기재한다. mode는 ${WRITING_MODES.join("|")} 중 하나를 고른다. 주된 mode는 requirements.mode를 우선하고, 지정된 값이 없으면 diagnose.primaryMode를 따른다. 기본은 주된 mode 하나로 통일하되, 내용상 필요한 경우에만 구간별로 다른 mode를 섞는다.`,
      "소제목 계층 구조를 정한다. 구간 안에 독자가 나중에 다시 찾아볼 대등한 항목이 2개 이상 있으면 subsections로 나누며, 하위 항목도 같은 기준으로 다시 나눌 수 있다. 계층 깊이는 내용의 포함 관계에 따라 정하며 따로 상한을 두지 않는다. 같은 단계의 항목은 3~5개를 목표로 하되, 하위 항목이 하나뿐이면 나누지 않는다. 하위 항목의 본문 분량은 해당 구간의 budget에 포함된다.",
      "제목과 소제목의 역할을 계층별로 나눈다. 글 제목은 이 글을 읽고 무엇을 알게 되는지를 비유 없이 바로 알 수 있게 쓴다. 구간 title은 그 구간에서 독자가 얻을 답을 짧고 자연스러운 말로 담아, 소제목만 훑어도 글 전체의 구조가 드러나게 한다. 하위 항목의 title은 독자가 다시 찾아볼 대상을 짧은 이름으로 쓰고 같은 단계의 항목끼리 같은 형태를 유지한다. 모든 제목은 정해진 문형에 맞추지 않으며, 독자의 호기심을 끄는 질문은 소제목에 두지 않고 hook에 둔다.",
      "독자 수준은 requirements.readerLevel을 우선하고, 지정된 값이 없으면 diagnose.readerLevel을 따른다. 개념은 prerequisite 의존 순서에 따라 배치하고 구간별 level을 적는다. value.excluded에 들어 있는 내용은 구간으로 넣지 않으며, 핵심 흐름 밖의 심화·호기심 구간은 optional을 true로 둔다.",
      `procedure가 아닌 구간에는 구간 카드의 항목인 hook(여는 질문: 구간의 첫 문장이 될 질문이나 통념을 뒤집는 주장), cases(research.cases에서 고른 사례 1~${MAX_CASES}개의 장면 원형), underline(강조 문장), principleLine(마무리 문장)을 모두 적는다.`,
      VOICE.slot("title·구간 title·hook·cases·underline·principleLine"),
      "cases에는 audience.scene의 내용을 되풀이하지 않고 그 뒤에 이어지는 장면을 적는다. keyPoint·hook·underline·principleLine은 서로 다른 내용으로 쓰며, 같은 문장을 낱말만 바꾸어 되풀이하지 않는다.",
      NATURAL_KOREAN,
      "여러 구간의 같은 항목(underline·principleLine 등)을 모두 같은 문형으로 쓰지 않는다. 문형은 내용에 맞게 정한다.",
      "explain 구간에 한하여 설계 카드인 concrete·walkthrough·refute·checkQuestion을 작성한다. analogySystem(mapping·limits)은 독자가 바로 떠올리는 일상 사물 하나가 개념과 직접 맞닿을 때만 쓰고, 그런 사물이 없으면 생략한다. 독자가 한 번 더 옮겨 생각해야 하는 추상적 비유(예: 분류 체계를 다른 사물의 배치에 빗대는 것)는 쓰지 않는다. 다만, 숙련 독자 대상인 경우에는 concrete와 walkthrough의 작성을 선택 사항으로 둔다. 다른 mode 구간에는 explain 설계 카드를 사용하지 않는다.",
      "requirements.length가 지정되어 있으면 구간마다 budget(공백 포함 글자 수, 정수)을 적되, 전체 합계를 지정 범위의 가운데 값 부근에 맞춘다(초고는 예산보다 조금 길어지는 경향이 있으므로 상한 쪽에 여유를 둔다). 범위를 맞추기 어려우면 구간 수를 2~8개 사이로 줄인다. 글 제목과 도입부는 첫 구간의 budget에, 끝 정리 목록은 마지막 구간의 budget에 넣는다.",
      `budget은 구간 카드의 각 항목을 문장으로 풀어 쓸 분량이다. 구간 카드 구간은 ${CARD_SPACE.section}자 이상으로 배정하고, 첫 구간에는 도입부 몫 ${CARD_SPACE.intro}자를, 마지막 구간에는 끝 정리 몫(구간 수 × ${CARD_SPACE.summaryLine}자)을 더한다. 전체 합계가 허용 범위를 넘으면 각 구간의 budget을 깎지 말고 구간 수를 줄인다.`,
      ...(state.retry?.stage === "outline"
        ? ["retryNote에는 직전 구성이 반려된 사유가 적혀 있다. 지적된 사항을 모두 고쳐 다시 쓴다."]
        : []),
    ],
    criteria: [
      "본문을 빼고 제목과 소제목만 남겼을 때 글이 알려 주는 것(제목), 글 전체의 구조(구간 title), 다시 찾아볼 대상 이름(하위 항목 title)이 비유 없이 바로 읽히는가",
      "subsections가 있는 곳마다 하위 항목이 2개 이상이고 같은 단계의 title이 서로 같은 형태인가",
      "구간마다 핵심 원칙이 하나이고 keyPoint가 1문장인가",
      "hook에서 제기한 질문이나 주장에 대한 답이 같은 구간의 keyPoint에 포함되어 있는가",
      `cases가 구간마다 1~${MAX_CASES}개이며 모두 해당 구간의 keyPoint를 직접 뒷받침하는가(흥미롭더라도 원칙과 무관한 사례는 제외하였는가)`,
      slotCheck("title", "title"),
      slotCheck("underline", "underline"),
      `${slotCheck("principleLine", "principleLine")} 단서('…라도', '…인 만큼')와 ${HYPE_HINT}가 없는가`,
      "keyPoint·hook·underline·principleLine을 순서대로 읽었을 때 같은 말의 되풀이가 아니라 논리적으로 한 걸음씩 나아가는가",
      `본문에 실릴 각 항목의 ${VOICE.check}`,
      "도입부 재료(audience.scene)와 같은 사건을 cases에서 처음부터 다시 쓰지 않았는가",
      "procedure가 아닌 모든 구간에 hook·cases·underline·principleLine이 빠짐없이 채워졌는가(시스템이 검사하여 누락 시 거부한다)",
      "requirements.length가 지정되어 있으면 모든 구간에 budget이 적혀 있고 그 합계가 허용 범위 안이며, 각 구간의 budget이 위에서 정한 최소 분량 이상인가(시스템이 검사하여 기준을 벗어나면 거부한다)",
    ],
  }),
  draft: (state, action) => {
    if (action.mode === "edit") return markedEditSpec(state, action);
    const section = action.section;
    const retry = section ?? action; // 반려 사유·반려 원고 · 구간별이면 구간에 실림
    const editing = Boolean(state.feedback);
    return {
      task: section ? sectionTask(section) : WHOLE_DRAFT_TASK,
      steps: [
        ...(retry.rejected
          ? [
              "baseline은 직전에 반려된 원고다. 처음부터 새로 쓰지 말고 반려 사유를 푸는 데 필요한 부분만 고친다. 분량을 넘어 반려되었다면 불필요한 문단이나 예시를 지워 분량을 줄인다.",
            ]
          : editing
            ? [
                "이번 작업은 기존 원고를 고치는 일이다. baseline이 있으면 그 원고를 바탕으로 고치되, feedback과 brief.priorities를 우선순위대로 반영하고 brief.preserve와 지적받지 않은 부분은 그대로 둔다.",
              ]
            : []),
        ...(!section || section.index === 0
          ? [
              `도입부: 첫 줄은 '# 제목'(outline.title을 그대로 적고, 없으면 독자가 얻을 것이 담긴 제목을 쓴다)으로 시작한다. ${LEAD.draft}`,
            ]
          : []),
        section
          ? `"${sectionHeading(section.title)}" 소제목 줄로 시작하여 이 구간만 쓴다.${section.index ? " previousSection(바로 앞 구간)과 자연스럽게 이어지게 쓰되 앞선 내용을 되풀이하지 않는다." : ""}`
          : `outline.sections의 순서대로 각 구간을 쓴다. 모든 구간은 "${sectionHeading("title")}" 소제목 줄로 시작한다.`,
        `구간 카드에 subsections가 있으면 하위 소제목으로 들어가기 전에 아래에 이어질 항목을 1~2문장으로 안내한 뒤 subsections를 순서대로 쓴다. 하위 소제목 줄은 title을 그대로 써서 한 단계씩 낮추어 적되, 구간 바로 아래는 "${subsectionHeading("title", 1)}", 그 아래는 "${subsectionHeading("title", 2)}" 형식으로 적고 단계를 건너뛰지 않는다.`,
        ...(!section || section.index === section.total - 1
          ? [
              `글의 마지막에는 '${summaryHeading}' 아래에 모든 구간의 principleLine을 순서대로 글자 그대로 목록으로 묶어 정리한다(principleLine이 없는 구간은 keyPoint를 쓴다). 이 끝 정리는 본문 소제목 계층 바깥에 따로 둔다.`,
            ]
          : []),
      ],
      rules: seasoningRules("draft", resolveDirection(state)),
      criteria: [
        section?.budget
          ? `이 구간에서 독자에게 보이는 글자 수(공백 포함, 마크다운 링크 주소 제외)가 약 ${section.budget}자인가(시스템이 검사하여 ${section.limit}자를 넘${section.floor ? `거나 ${section.floor}자에 모자라` : "으"}면 다시 쓰게 된다)`
          : "분량이 requirements.length 기준에 부합하는가(시스템이 검사하여 기준을 벗어나면 재작성 대상이 된다). requirements.length가 없으면 글의 목적에 적절한 분량인가",
        ...(retry.retryNote ? [`직전 반려 사유(${retry.retryNote})를 해결하였는가`] : []),
        "구간 카드에 없는 구간·사례·핵심 원칙을 임의로 보태지 않았는가",
        "value.preserve에 적힌 조건과 사실이 빠지지 않았는가",
        "research.evidence와 제공 자료에 없는 사실·수치·출처가 들어가지 않았는가",
      ],
      outputNotes: section
        ? [
            "text에는 이 구간의 본문만 적고, changeSummary에는 이 구간에서 한 작업을 요약한 1문장을 적는다.",
          ]
        : ["text에는 글 전체의 본문을 적는다."],
    };
  },
  review: (state) => {
    const direction = resolveDirection(state);
    const checks = reviewChecks(direction);
    return {
      task: "기준표에 따라 초고를 판정한다. 독자가 이 글을 처음 접하는 상황을 가정하고 읽는다.",
      steps: [
        "작성자와 독립된 시각에서 오류를 점검한다. 단정·수치·필수조건을 source 및 research와 대조하고, 주체와 대상이나 개념과 기능의 혼동, 독자의 이해를 막는 지점을 확인한다.",
        `checks에는 아래 기준마다 id·pass·note를 하나씩 적는다. note에는 판정의 근거가 된 본문 표현이나 측정값을 적는다.\n${checks.map(({ id, ask }) => `   - ${id}: ${ask}`).join("\n")}`,
        "통과하지 못한 기준과 그 밖의 문제점은 findings에 한 항목씩 적는다.",
        "분량은 draftCharacterCount(공백·줄바꿈 포함 유니코드 문자 수)로만 판단하며 추정 수치를 쓰지 않는다. 문장·문단·구간 길이와 소제목·구간 카드 반영 여부는 시스템이 세거나 글자를 대조하여 계산한 draftMetrics 값만 인용한다. 그 밖의 기준은 본문을 직접 읽고 판단하되 근거가 되는 표현을 인용한다.",
        "verdict는 다음 가운데 하나라도 해당하면 revise로, 모두 해당하지 않으면 pass로 판정한다. (가) brief(수정 해석)가 있고 acceptance.criteria·priorities를 채우지 못한 경우 (나) draftMetrics.cardTransfer의 missing·notInSummary 목록에 구간이 남았거나 titleMatches가 false인 경우 (다) S10이나 R 기준을 통과하지 못한 경우. 다만 단순 문체 취향이나 분량 수치는 revise 사유로 삼지 않는다(분량은 시스템이 따로 검사한다).",
        "verdict가 revise이면 unmetCriteria에 못 채운 사유를 적고, reviseFrom에 다시 시작할 단계를 적되 구간 카드 자체에 결함이 있으면 outline을, 그 밖의 경우에는 draft를 적는다.",
      ],
      rules: seasoningRules("review", direction),
      criteria: [
        `checks에 ${checks.map(({ id }) => id).join("·")} 항목이 하나씩 빠짐없이 들어 있는가`,
        "findings의 각 항목마다 기준 ID, 해당 구간, 문제 표현 인용, 사유가 적혀 있는가",
        "수치를 직접 계산하거나 어림잡지 않고 주어진 측정값만 인용했는가",
        "근거 없이 정확하다고 단정하거나 독자 검증 결과를 주장하지 않았는가",
        "대신 쓸 문장을 직접 적어 내놓지 않고 판정 결과만 적었는가",
      ],
    };
  },
};

const WHOLE_DRAFT_TASK =
  "구간 카드를 순서대로 문장으로 옮겨 글 전체를 쓴다. 다룰 내용은 이미 구간 카드에서 정해졌으므로, 작성 담당자는 카드의 각 항목을 독자가 읽기 쉬운 문장으로 풀어 쓰는 역할만 맡는다.";

// 구간별 초고 한 호출의 과업 · ADR-0009
const sectionTask = ({ index, total, title }) =>
  `구간별 초고 ${index + 1}/${total}: "${title}". 구간 카드에서 이 구간의 각 항목을 문장으로 옮겨 쓴다. 다룰 내용은 구간 카드에서 이미 정해졌으며, 다른 구간은 쓰지 않는다.`;

/** @param {any} state @param {{stage: string, section?: any}} action */
export function stageSpec(state, action) {
  const spec = STAGE_SPECS[action.stage];
  if (!spec) throw new Error("Unsupported prompt stage");
  return { example: stageOutputExamples[action.stage], ...spec(state, action) };
}

// 문장 편집·교열 수정: 원고를 다시 쓰지 않고 변경 표시만 낸다 · 코드가 표시를 원고에 적용 · ADR-0018
function markedEditSpec(state, action) {
  return {
    task: "이번 작업은 기존 원고(baseline)의 문장을 다듬거나 교열하는 일이다. 원고를 다시 쓰지 않고, 바꿀 부분마다 변경 표시(find → replace)만 만든다.",
    steps: [
      "brief.priorities를 순서대로 살펴 각 항목을 풀기 위해 고칠 부분을 baseline에서 찾는다.",
      "edits의 각 항목에서 find에는 baseline의 해당 부분을 글자 그대로 옮겨 적고, replace에는 그 자리에 들어갈 글을 적는다. find는 baseline에 한 번만 나오도록 필요한 만큼 앞뒤 글자를 넣고, 항목끼리 겹치지 않게 한다.",
      "문단을 나눌 때는 나눌 자리의 앞뒤 문장을 find로 잡고, replace에서 두 문장 사이에 빈 줄을 넣는다.",
      "brief.priorities에 해당하지 않는 부분은 표시하지 않는다. 표시하지 않은 부분은 시스템이 원고 그대로 둔다.",
    ],
    rules: seasoningRules("draft", resolveDirection(state)),
    criteria: [
      "brief.priorities의 모든 항목이 하나 이상의 변경 표시로 해결되었는가",
      "모든 find가 baseline에 글자 그대로 한 번만 있는가(시스템이 대조하여 어긋나면 반려한다)",
      "brief.preserve에 해당하는 부분을 바꾸지 않았는가",
      ...(action.retryNote ? [`직전 반려 사유(${action.retryNote})를 해결하였는가`] : []),
    ],
    outputNotes: ["changeSummary에는 이번 수정 내용을 요약한 1문장을 적는다."],
    example: draftEditExample,
  };
}
