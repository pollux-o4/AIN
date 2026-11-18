// 단계별 과업 정의: 이번 일 · 순서 · 통과 기준 · 새 단계는 여기에 항목 하나를 더한다 · ADR-0013
// 칸의 뜻은 contracts/ai-output(출력 예시로 실림), 문체·장르 규칙은 seasoning이 소유한다
import { stageOutputExamples } from "../../contracts/ai-output.mjs";
import {
  sectionHeading,
  subsectionHeading,
  summaryHeading,
} from "../../contracts/article-structure.mjs";
import {
  AUTO,
  CARD_SPACE,
  MAX_CASES,
  READER_LEVELS,
  SLOT_MAX,
  WRITING_MODES,
} from "../../contracts/writing-modes.mjs";
import { requirementValue } from "../../editorial/domain/index.mjs";
import { HYPE_HINT, resolveDirection, reviewChecks, seasoningRules, VOICE } from "../seasoning.mjs";

// 요구 장부가 정한 서술 방식·독자 수준 · 없으면 진단이 판단 · ADR-0016
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
        "idea에서 사용자가 요구하는 결과를 파악한다. 즉, 어떤 주제의 글을 누구에게 어떤 조건(분량·시점·금지 사항 등)으로 작성해야 하는지 확인한다.",
        mode
          ? `requirements.mode ${mode}를 primaryMode로 그대로 반환한다.`
          : `requirements.mode가 없으면 ${MODE_GUIDE} 중에서 primaryMode를 판단한다. 독자가 글을 읽은 뒤 수행할 행동을 기준으로 선택하되, 두 가지 이상이 해당하면 글에서 비중이 가장 큰 하나를 선택한다.`,
        level
          ? `requirements.readerLevel ${level}를 readerLevel로 그대로 반환한다.`
          : `requirements.readerLevel이 없으면 ${LEVEL_GUIDE} 중에서 readerLevel을 판단한다. 다만, 자료에 독자 수준을 가늠할 단서가 없는 경우에는 beginner로 정한다.`,
        "sectionModes에는 예상되는 각 구간의 서술 방식을 하나씩 기재한다. 기본값은 primaryMode로 통일한다.",
        VOICE.decide,
        "idea에서 사용자가 명시한 조건(분량·서술 방식·독자 수준·어조·범위·금지 사항 등) 가운데 requirements에 아직 없거나 기존 값과 다른 항목은 requirementChanges에 op set으로 기재한다. quote에는 근거가 된 idea 문장을 그대로 옮긴다. 해당하는 조건이 없으면 빈 배열로 둔다.",
      ],
      criteria: [
        "purpose가 '독자가 …하게 한다' 형식의 1문장인가",
        "requirementChanges에 idea에 실제로 명시된 조건만 담았으며 quote가 idea 문장 그대로인가",
        `primaryMode는 ${WRITING_MODES.join("|")}, readerLevel은 ${READER_LEVELS.join("|")} 중 하나인가`,
        "requirements와 idea의 모든 조건이 strategy에 빠짐없이 반영되었는가",
        "자료에 없는 독자 정보나 사실을 임의로 만들어 내지 않았는가",
      ],
    };
  },
  topic: () => ({
    task: "이 글에서 해결할 핵심 문제 하나와 다룰 범위를 정하고 제목 후보 3개를 작성한다.",
    steps: [
      "problem에는 독자가 겪는 문제를 독자가 실제로 사용할 만한 표현으로 1문장으로 기재한다.",
      "scope에는 이 글에서 다루는 내용과 다루지 않는 내용을 구분하여 기재한다. 다만, idea에 분량 요구가 있으면 해당 분량 안에 수용할 수 있는 범위로 설정한다.",
      "titleCandidates에는 제목 후보 3개를 약속형(읽으면 얻는 것), 궁금증형(질문 또는 뜻밖의 사실), 경고형(피해야 할 실수) 순서로 기재한다.",
    ],
    criteria: [
      "problem이 단일 문제만 다루고 있으며 두 문제를 '그리고' 등으로 묶지 않았는가",
      "제목 후보가 유형별로 1개씩 총 3개인가",
      `모든 제목이 공백 포함 40자 이내이고 독자가 모를 전문어와 ${HYPE_HINT}가 없는가`,
      "제목이 약속한 내용을 scope 범위 안에서 충족할 수 있는가",
    ],
  }),
  audience: () => ({
    task: "독자 카드를 작성한다. 구성 단계와 초고 단계는 설명 수준과 도입 장면을 이 카드에서 참조한다.",
    steps: [
      "reader와 intent는 diagnose 단계의 판단과 어긋나지 않도록 기재한다.",
      "readerTask에는 독자가 글을 읽은 뒤 수행할 수 있게 될 일을 1문장으로 기재한다.",
      "knows·unknownTerms·misconceptions·homonyms에는 글감과 자료에서 근거를 확인할 수 있는 항목만 기재하고, 해당하는 내용이 없으면 빈 배열로 둔다.",
      "scene에는 독자가 이 문제로 현재 겪고 있는 구체적 장면 하나를 2~3문장으로 기재한다. 본문은 이 장면으로 시작한다. 주인공은 한 사람으로 정하되, 자료에 등장인물이 있으면 그 인물을 사용하고 없으면 이름을 부여한 가상 인물(예: '가상의 인물 민지 씨')을 설정한다.",
      VOICE.slot("scene"),
    ],
    criteria: [
      "readerTask가 '…할 수 있다'로 끝나는 1문장인가",
      "scene에 주인공 한 사람, 시간 또는 장소 중 하나 이상, 그리고 관찰 가능한 구체적 행동이 포함되어 있는가",
      "scene이 자료에 근거한 상황인가, 만약 가상의 상황이라면 주인공을 '가상의 인물 …'로 명시하였는가",
      "scene이 오늘날의 독자가 실제로 겪을 수 있는 상황인가",
      "근거가 없는 항목을 채우기 위해 내용을 임의로 만들어 내지 않았는가",
    ],
  }),
  value: () => ({
    task: "독자에게 제공할 결과와 약속을 정하고, 그 목적에 필요하지 않은 내용을 범위에서 제외한다.",
    steps: [
      "outcome에는 audience.readerTask를 달성한 결과를 1문장으로 기재한다.",
      "promise에는 동일한 내용을 독자에게 건네는 약속 1문장으로 기재한다. 이 문장은 글머리에서 도입 장면 바로 뒤에 원문 그대로 사용된다.",
      VOICE.slot("promise"),
      "preserve에는 글감과 원문에서 반드시 유지해야 할 조건·사실·목소리를 기재한다.",
      "readerTask 달성에 불필요한 내용은 excluded에 기재한다. 다만, requirements.length가 지정되어 있으면 다룰 범위를 그 분량에 맞추어 조정한다.",
    ],
    criteria: [
      "promise가 '…할 수 있다'는 의미로 끝나는 1문장이며 readerTask와 동일한 과업을 가리키는가",
      `promise에 ${HYPE_HINT}가 없으며 이 글의 범위 안에서 이행할 수 있는가`,
      "사용자가 idea에 명시한 조건이 preserve에 모두 포함되어 있는가",
      "excluded의 항목이 preserve의 항목과 중복되거나 상충하지 않는가",
    ],
  }),
  research: () => ({
    task: "주어진 자료에서 글의 근거가 될 사실과 원칙을 보여 줄 사례 후보를 선별한다.",
    steps: [
      "source와 idea에서 글의 근거로 삼을 사실을 선별하여 evidence에 claim과 출처(url)로 기재한다. 이때 자료의 어느 문장에서 비롯되었는지 특정할 수 있는 사실만 기재한다.",
      "글 작성에 필요하지만 자료만으로 확인되지 않는 내용은 uncertainties에 기재한다.",
      "cases에는 사례 후보를 3~6개 기재한다. 사례는 교훈을 서술하는 요약이 아니라 구체적 장면이어야 하며, 주인공이 언제·어디서 무엇을 하였고 관찰 가능한 결과(사물·횟수·시간 등)가 어떠하였는지를 담아야 한다.",
      "자료에 포함된 사례는 origin을 source로 기재한다. 자료에 없어 새로 구성한 가상 사례는 origin을 hypothetical로 기재하되, audience.scene의 주인공이 이후에 겪는 장면으로 이어서 작성한다(사례마다 새로운 인물을 만들지 않는다).",
    ],
    criteria: [
      "모든 claim이 자료 내 문장으로 확인되며 기억이나 추측으로 작성하지 않았는가",
      "새로 구성한 가상 사례의 origin이 모두 hypothetical이며 실존 인물·기관·통계를 임의로 만들지 않았는가(장면 내 수치는 상황 묘사에 한하며 효과나 비율의 근거로 제시하지 않았는가)",
      "사례마다 주인공의 구체적 행동 하나와 관찰 가능한 결과가 포함되어 있으며, '위험해졌다·편해졌다'와 같은 추상적 평가만으로 이루어지지 않았는가",
      "사례 내용에 교훈이나 원칙을 서술하는 문장이 섞이지 않았는가",
      "가상 사례의 주인공이 audience.scene의 주인공과 동일 인물인가",
      "사례가 오늘날의 독자가 실제로 겪을 수 있는 상황인가",
      "evidence와 uncertainties 중 적어도 하나는 비어 있지 않은가",
    ],
  }),
  outline: (state) => ({
    task: "구간별 구성 카드를 작성한다. 작성 담당자는 카드의 각 칸을 문장으로 옮기는 작업만 수행하므로, 글의 완성도와 수준은 이 카드에서 결정된다.",
    steps: [
      "title에는 topic.titleCandidates 가운데 value.promise를 가장 잘 전달하는 제목 하나를 글자 그대로 옮겨 기재한다. 다만, 적절한 후보가 없는 경우에는 약속형 제목을 새로 작성한다.",
      `글의 구간을 나눈 뒤, 구간마다 하나의 핵심 원칙(keyPoint)을 정하여 title·mode·keyPoint를 기재한다. mode는 ${WRITING_MODES.join("|")} 중 하나를 선택한다. 주된 mode는 requirements.mode를 우선하고, 지정된 값이 없으면 diagnose.primaryMode를 따른다. 기본은 주된 mode 하나로 통일하되, 내용상 필요한 경우에만 구간별로 다른 mode를 혼합한다.`,
      "소제목 계층 구조(ADR-0014)를 정한다. 구간 내부에 독자가 추후 다시 찾아볼 대등한 항목이 2개 이상 있으면 subsections로 분할하며, 하위 마디 역시 동일한 기준으로 다시 분할할 수 있다. 계층 깊이는 내용의 포함 관계에 따라 정하며 별도의 상한을 두지 않는다. 한 단계의 형제 항목은 3~5개를 목표로 하되, 하위 항목이 하나뿐이면 분할하지 않는다. 하위 마디의 본문 분량은 해당 구간의 budget에 포함된다.",
      "제목과 소제목의 역할을 계층별로 구분한다. 글 제목은 읽기 전의 약속을 제시하고, 구간 title은 이름표와 결론을 담아 훑어 읽는 독자에게 전체 지도를 제공하며, 하위 title은 다시 찾아오는 독자가 해당 항목을 쉽게 식별할 수 있도록 짧은 이름표 형태로 작성하되 형제 항목끼리 동일한 문장 형태를 유지한다. 독자의 호기심을 유발하는 질문은 소제목이 아니라 hook에 배치한다.",
      "독자 수준은 requirements.readerLevel을 우선하고, 지정된 값이 없으면 diagnose.readerLevel을 따른다. 개념은 prerequisite 의존 순서에 따라 배치하고 구간별 level을 기재한다. value.excluded에 속한 내용은 구간으로 구성하지 않으며, 핵심 흐름 밖의 심화·호기심 구간은 optional을 true로 설정한다.",
      `procedure가 아닌 구간에는 이야기 카드 항목인 hook(구간의 첫 문장이 될 질문이나 통념을 뒤집는 주장), cases(research.cases에서 선별한 사례 1~${MAX_CASES}개의 장면 원형), underline(밑줄 문장) 및 principleLine(구간을 마무리하는 한 줄 원칙)을 모두 기재한다.`,
      VOICE.slot("title·구간 title·hook·cases·underline·principleLine"),
      "cases에는 audience.scene의 내용을 반복하지 않고 그 이후에 이어지는 장면을 기재한다. keyPoint·hook·underline·principleLine은 서로 다른 내용으로 작성하며, 동일한 문장을 어휘만 바꾸어 반복하지 않는다.",
      "explain 구간에 한하여 설계 카드인 concrete·walkthrough·refute·checkQuestion과 비유 체계인 analogySystem(mapping·limits)을 작성한다. 다만, 숙련 독자 대상인 경우에는 concrete와 walkthrough의 작성을 선택 사항으로 둔다. 다른 mode 구간에는 explain 설계 카드를 사용하지 않는다.",
      "requirements.length가 지정되어 있으면 구간마다 budget(공백 포함 글자 수, 정수)을 기재하되, 전체 합계를 지정 범위의 중앙값 부근에 맞춘다(초고는 예산보다 다소 길어지는 경향이 있으므로 상한 쪽에 여유를 둔다). 범위를 맞추기 어려우면 구간 수를 2~8개 사이로 조정하여 줄인다. 글 제목과 도입부는 첫 구간의 budget에, 끝 정리 목록은 마지막 구간의 budget에 포함한다.",
      `budget은 카드의 각 칸을 문장으로 전개할 분량이다. 이야기 카드 구간은 ${CARD_SPACE.section}자 이상으로 배정하고, 첫 구간에는 글머리 몫 ${CARD_SPACE.intro}자를, 마지막 구간에는 끝 정리 몫(구간 수 × ${CARD_SPACE.summaryLine}자)을 가산한다. 전체 합계가 허용 범위를 초과하면 각 구간의 budget을 삭감하지 말고 구간 수를 줄인다.`,
      ...(state.retry?.stage === "outline"
        ? [
            "retryNote에는 직전 구성이 반려된 사유가 기재되어 있다. 지적된 사항을 모두 수정하여 다시 작성한다.",
          ]
        : []),
    ],
    criteria: [
      "본문을 제외하고 제목과 소제목만 남겼을 때 글의 약속(제목), 전체 지도(구간 title) 및 재참조할 항목 이름(하위 title)이 명확히 드러나는가",
      "subsections가 존재하는 마디마다 하위 항목이 2개 이상이며 형제 title이 동일한 문장 형태를 취하고 있는가",
      "구간마다 원칙이 하나이고 keyPoint가 1문장인가",
      "hook에서 제기한 질문이나 주장에 대한 답이 같은 구간의 keyPoint에 포함되어 있는가",
      `cases가 구간마다 1~${MAX_CASES}개이며 모두 해당 구간의 keyPoint를 직접 뒷받침하는가(흥미롭더라도 원칙과 무관한 사례는 제외하였는가)`,
      `underline이 'A가 아니라 B' 형식의 대비이거나 구체적인 사물 비유를 담은 1문장이며 ${SLOT_MAX.underline}자 이내인가(시스템이 글자 수를 산출하여 초과 시 거부한다)`,
      `principleLine이 명령형·단정형 1문장이고 ${SLOT_MAX.principleLine}자 이내이며 단서('…라도', '…인 만큼')와 ${HYPE_HINT}가 없는가`,
      "keyPoint·hook·underline·principleLine을 순서대로 읽었을 때 동일한 내용의 반복이 아니라 논리적으로 한 단계씩 전개되는가",
      `본문에 수록될 각 칸의 ${VOICE.check}`,
      "도입 장면(audience.scene)과 동일한 사건을 cases에서 처음부터 다시 서술하지 않았는가",
      "procedure가 아닌 모든 구간에 hook·cases·underline·principleLine이 빠짐없이 채워졌는가(시스템이 검사하여 누락 시 거부한다)",
      "requirements.length가 지정된 경우 모든 구간에 budget이 기재되어 있고 그 합계가 허용 범위 안에 있으며, 각 구간의 budget이 위에서 정한 최소 분량 이상인가(시스템이 검사하여 기준을 벗어나면 거부한다)",
    ],
  }),
  draft: (state, action) => {
    const section = action.section;
    const editing = Boolean(state.feedback);
    return {
      task: section ? sectionTask(section) : WHOLE_DRAFT_TASK,
      steps: [
        ...(section?.rejected
          ? [
              "baseline은 직전에 분량 초과로 반려된 이 구간의 원고이다. 처음부터 새로 작성하지 말고 baseline에서 불필요한 문단이나 예시를 삭제하여 분량을 줄인다.",
            ]
          : editing
            ? [
                "이번 과업은 기존 원고의 수정이다. baseline이 존재하면 해당 원고를 바탕으로 수정하되, feedback과 brief.priorities를 우선순위대로 반영하고 brief.preserve 및 지적받지 않은 부분은 그대로 유지한다.",
              ]
            : []),
        ...(!section || section.index === 0
          ? [
              "글머리: 첫 줄은 '# 제목'(outline.title을 그대로 기재하며, 없는 경우에는 약속이 담긴 제목을 작성한다)으로 시작하고, 첫 문단은 audience.scene을 2~4문장의 장면으로 작성하며(첫 문장은 주인공의 행동으로 시작하고 주인공·시간·장소를 누락하지 않는다), 둘째 문단은 value.promise(원문 그대로)와 이 글이 다루는 전개 순서 1문장으로 작성한다. 글머리에 audience.unknownTerms의 용어를 사용하는 경우에는 해당 위치에서 즉시 풀이한다.",
            ]
          : []),
        section
          ? `"${sectionHeading(section.title)}" 소제목 줄로 시작하여 이 구간만 작성한다.${section.index ? " previousSection(바로 앞 구간)과 자연스럽게 연결되도록 서술하되 앞선 내용을 반복하지 않는다." : ""}`
          : `outline.sections의 순서대로 각 구간을 작성한다. 모든 구간은 "${sectionHeading("title")}" 소제목 줄로 시작한다.`,
        `구성 카드에 subsections가 있는 경우에는 해당 마디의 첫머리에서 이하에 전개될 항목을 1~2문장으로 안내한 뒤 subsections를 순서대로 작성한다. 하위 소제목 줄은 title을 그대로 사용하여 한 단계씩 낮추어 표기하되, 구간 바로 아래는 "${subsectionHeading("title", 1)}", 그 아래는 "${subsectionHeading("title", 2)}" 형식으로 작성하며 단계를 건너뛰지 않는다.`,
        ...(!section || section.index === section.total - 1
          ? [
              `글의 마지막에는 '${summaryHeading}' 아래에 모든 구간의 principleLine을 순서대로 글자 그대로 목록화하여 정리한다(principleLine이 없는 구간은 keyPoint를 사용한다). 이 끝 정리는 본문 소제목 계층 구조의 바깥에 독립적으로 배치한다.`,
            ]
          : []),
      ],
      rules: seasoningRules("draft", resolveDirection(state)),
      criteria: [
        section?.budget
          ? `이 구간에서 독자에게 노출되는 글자 수(공백 포함, 마크다운 링크 주소 제외)가 약 ${section.budget}자인가(시스템이 검사하여 ${section.limit}자를 초과하${section.floor ? `거나 ${section.floor}자에 미달하` : ""}면 재작성 대상이 된다)`
          : "분량이 requirements.length 기준에 부합하는가(시스템이 검사하여 기준을 벗어나면 재작성 대상이 된다). requirements.length가 없으면 글의 목적에 적절한 분량인가",
        ...(section?.retryNote ? [`직전 반려 사유(${section.retryNote})를 해결하였는가`] : []),
        "구성 카드에 없는 구간·사례·원칙을 임의로 추가하지 않았는가",
        "value.preserve에 명시된 조건과 사실이 누락되지 않았는가",
        "research.evidence와 제공 자료에 없는 사실·수치·출처가 포함되지 않았는가",
      ],
      outputNotes: section
        ? [
            "text에는 이 구간의 본문만 기재하고, changeSummary에는 이 구간의 작업 내용을 요약한 1문장을 기재한다.",
          ]
        : ["text에는 글 전체의 본문을 기재한다."],
    };
  },
  review: (state) => {
    const direction = resolveDirection(state);
    const checks = reviewChecks(direction);
    return {
      task: "기준표에 따라 초고를 판정한다. 독자가 이 글을 처음 접하는 상황을 가정하고 읽는다.",
      steps: [
        "작성자와 독립된 관점에서 오류를 점검한다. 단정·수치·필수조건을 source 및 research와 대조하고, 주체와 대상 또는 개념과 기능의 혼동이나 독자의 이해가 저해되는 지점을 확인한다.",
        `checks에는 아래 각 기준마다 id·pass·note를 하나씩 기재한다. note에는 판정의 근거가 된 본문 표현이나 측정값을 기재한다.\n${checks.map(({ id, ask }) => `   - ${id}: ${ask}`).join("\n")}`,
        "미통과 기준과 기타 문제점은 findings에 한 항목씩 기재한다.",
        "분량은 draftCharacterCount(공백·줄바꿈 포함 유니코드 문자 수)로만 판단하며 추정 수치를 쓰지 않는다. 문장·문단·구간 길이와 소제목·카드 반영 여부는 시스템이 계측하고 문자열 대조로 산출한 draftMetrics 값만 인용한다. 그 밖의 기준은 본문을 직접 읽고 판단하되 근거가 되는 표현을 인용한다.",
        "verdict는 다음 각 호 중 하나라도 해당하면 revise로, 모두 해당하지 않으면 pass로 판정한다. (가) brief(편집 메모)가 존재하고 acceptance.criteria·priorities를 충족하지 못한 경우 (나) draftMetrics.cardTransfer의 missing·notInSummary 목록에 구간이 남았거나 titleMatches 또는 promiseInLead가 false인 경우 (다) S10 또는 R 기준을 통과하지 못한 경우. 다만, 단순 문체 취향이나 분량 수치는 revise 사유로 삼지 않는다(분량은 시스템이 별도로 검사한다).",
        "verdict가 revise인 경우에는 unmetCriteria에 미충족 사유를 기재하고, reviseFrom에 재시작할 단계를 기재하되 구성 카드 자체에 결함이 있으면 outline을, 그 밖의 경우에는 draft를 기재한다.",
      ],
      rules: seasoningRules("review", direction),
      criteria: [
        `checks에 ${checks.map(({ id }) => id).join("·")} 항목이 하나씩 빠짐없이 포함되어 있는가`,
        "findings의 각 항목마다 기준 ID, 해당 구간, 문제 표현 인용 및 사유가 기재되어 있는가",
        "수치를 직접 산출하거나 어림잡지 않고 제공된 측정값만 인용하였는가",
        "근거 없이 정확성을 단정하거나 독자적 검증 결과를 주장하지 않았는가",
        "대체 문장을 직접 작성하여 제시하지 않고 판정 결과만 기술하였는가",
      ],
    };
  },
};

const WHOLE_DRAFT_TASK =
  "구성 카드를 순서대로 문장으로 옮겨 글 전체를 작성한다. 다룰 내용은 이미 구성 카드에서 정해졌으므로, 작성 담당자는 카드의 각 칸을 독자가 읽기 쉬운 문장으로 풀어 쓰는 역할만 수행한다.";

// 구간별 초고 한 호출의 과업 · ADR-0009
const sectionTask = ({ index, total, title }) =>
  `구간별 초고 ${index + 1}/${total}: "${title}". 구성 카드에서 이 구간의 각 칸을 문장으로 옮겨 작성한다. 다룰 내용은 구성 카드에서 이미 정해졌으며, 다른 구간은 작성하지 않는다.`;

/** @param {any} state @param {{stage: string, section?: any}} action */
export function stageSpec(state, action) {
  const spec = STAGE_SPECS[action.stage];
  if (!spec) throw new Error("Unsupported prompt stage");
  return { ...spec(state, action), example: stageOutputExamples[action.stage] };
}
