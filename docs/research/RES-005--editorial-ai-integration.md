# RES-005 · AIN 편집 AI 반영안

- 현재 일부만 적용된 상태이다. 단계 산출물의 선택 항목(audience, value, outline 구간 카드, analogySystem), mode별 규칙, 코드 지표 `draftMetrics`는 적용되었다. 다만 다중 이름 후보, 오해 반박 누락 지표, 혼동 보정 정규화(편집장 판정으로 대체 중, ADR-0006), 항목 필수화는 아직 적용되지 않았다.
- 이 문서는 RES-004의 절차를 AIN 8단계 산출물, 지표, 규칙, 피드백 루프, 검증으로 옮기는 설계를 다룬다.
- 관련 문서는 FLOW-002(진단·sectionModes·검토), `automation/paseo/prompts/`, `automation/contracts/ai-output.mjs`, PILOT-001(독자 과업)이다.
- FLOW-002의 "개념 설명 순서의 일괄 강제 제외" 제약은 그대로 유지한다. sectionModes는 현재 자유 문자열(예: `explanation`)이며, mode 이름(explain·procedure·argue·narrate)은 제안한 분류이다.
- 변경 이유는 AIN 계약과 단계 설계 변경이다.

## 산출물 설계

### 정처기 감자 작성 방식과 AIN 단계 대응

| 감자 | AIN 단계 | 비고 |
| --- | --- | --- |
| 기출 분석으로 최소 범위 결정 | topic · value | 독자가 할 수 있게 될 일을 기준으로 삼는다. |
| 독자=비전공 수험생 고정 | diagnose · audience | readerLevel과 오해를 추가한다. |
| 출처·기출 확인과 "아직 확인되지 않음" 명시 | research | 기존 uncertainties를 활용한다. |
| 템플릿과 일관 비유 적용 | outline | 구간 카드와 비유 대응표를 사용한다. |
| AI 공동 초안 작성 | draft | 규칙을 강화한다. |
| 정답 공개 전 확인과 연습 문제 | review(+ 선택 산출) | 확인 질문을 둔다. |
| 댓글 제보 기반 혼동 보정 로그 | feedback → route | 혼동 지점 단위로 기록한다. |

### 단계별 산출물 제안

- 기존 8단계 구성을 유지하며 새 단계는 추가하지 않는다.

| 단계 | 현재 | 추가 제안 | 원칙 |
| --- | --- | --- | --- |
| diagnose | purpose, audience, sectionModes, preserveVoice, strategy | `readerLevel`을 추가하고, 구간 분류는 Diátaxis 두 질문(행동/인지, 습득/적용)으로 판단한다. | P1 |
| audience | reader·intent | `knows[]`, `unknownTerms[]`, `misconceptions[]`, `homonyms[]`, `readerTask`를 추가한다. | P1·P5 |
| value | outcome·preserve | outcome은 읽고 나서 할 수 있는 일 1문장으로 작성하고, 범위 밖 항목은 `excluded[]`에 기록한다. | P2 |
| research | evidence·uncertainties | 예시 값의 임의성과 출제·근거 미확인 사실을 uncertainties에 기록한다. | P5 |
| outline | sections·rationale | `analogySystem{source, mapping[], limits[]}`를 추가하고, sections는 `{title, mode, level, optional, prerequisite, keyPoint, concrete, walkthrough, refute, checkQuestion}`으로 구성한다. | P2~P6 |
| draft | text·changeSummary | draft 규칙 초안을 적용하며, 소제목과 캡션은 결론형으로 쓰고 한 대상에는 한 이름만 쓴다. | P2~P5 |
| review | findings·preservationCheck | findings에 원칙 ID(P1~P6)와 구간을 표시하고 `paraphrase`(핵심을 독자 말로 3문장 재진술한 뒤 원문과 불일치 지점 기록)를 추가한다. 측정값은 코드 제공값만 사용한다. | 전체 |

- explain 구간에만 구간 카드 항목을 필수로 두고, 다른 mode는 `keyPoint`만 필수로 둔다(FLOW-002 일괄 강제 제외).
- `readerLevel`이 높으면 `concrete`와 `walkthrough`는 선택 사항으로 두고 풀이 밀도를 낮춘다.
- 현재 `looseObject` 스키마이므로 항목을 추가해도 기존 파싱과 호환되며, 필수화 여부는 따로 정한다.

## 생성·검토 규칙

### 코드로 계산할 지표

- 이 지표는 review 단계의 입력 자료로 쓴다.

| 지표 | 계산 | 용도 |
| --- | --- | --- |
| 문장 길이 중앙값·상위 10% | 문장부호로 분리한 뒤 공백 포함 유니코드 문자 수를 계산한다. | 긴 문장 후보 표시 |
| 문단 최대 길이 | 빈 줄을 기준으로 문단 길이를 계산한다. | 서식 없는 장문 구간 후보(F자 스캔 조건) |
| 소제목 수·간격 | 마크다운 제목을 기준으로 계산한다. | layer-cake 스캔 지원 여부 |
| 미풀이 용어 | `unknownTerms` 첫 등장 문장에 괄호·정의 패턴이 없는 경우를 탐지한다. | P1 |
| 다중 이름 후보 | 사용자 용어집 또는 `homonyms`를 기준으로 탐지한다. | 용어 불일치 |
| 오해 반박 누락 | `misconceptions` 항목별 본문 대응 문장 유무를 확인한다(AI 판단 보조). | P5 |

- 기준값은 경고용이며, 정처기 감자 사례의 실측값(문장 중앙값 40~51자)은 참고 사례일 뿐 표준이 아니다.
- 기존 `draftCharacterCount`와 마찬가지로 수치는 코드가 계산하고 해석은 AI가 맡는다.

### draft 규칙 초안

- 적용 대상은 explain 구간이다.

```text
- 첫 문단은 정의 1문장, 이 글로 할 수 있게 될 일과 다룰 개념 목록으로 구성한다.
- 근거가 확인되지 않은 중요도와 출제 여부, 수치는 "확인되지 않음"으로 명시한다.
- 비유는 outline.analogySystem 하나만 사용하며 새 비유를 추가하지 않는다. 맞지 않는 지점은 1문장으로 밝힌다.
- 구간마다 개념 1개씩 정의 → 비유 대응 → 이유 → 따라가는 예제(단계 번호) 순으로 전개한다.
- misconceptions마다 "흔히 ~라고 생각하지만 ~" 형태의 반박 문단을 둔다.
- homonyms마다 "이름만 같고 대상이 다름"을 밝히는 구분 문장을 둔다.
- 소제목과 그림 설명은 결론 문장으로 작성한다.
- 전문어는 첫 등장 시 괄호로 풀이하며, 같은 대상에는 같은 이름만 사용한다.
- optional 구간은 본문 흐름 밖(접기 또는 "더 알아보기")에 배치한다.
- 구간 끝 checkQuestion은 본문만으로 답할 수 있게 작성한다.
```

## 운영·검증

### 혼동 보정 루프

- 입력으로는 사용자 feedback을 받는다.
- 사용자 피드백을 "어느 구간·어떤 표현에서 무엇을 헷갈렸나"로 정규화하면, route가 이에 따라 outline(구조)과 draft(표현) 중 수정 대상을 고른다.
- 보정 이력은 revision마다 현행 history에 보존하며, 같은 오해가 반복되면 audience.misconceptions로 승격한다.
- AI가 스스로 피드백이나 만족 여부를 생성하지 않는 현행 원칙을 유지한다.

### 검증

- 단위 검증에서는 지표 계산 fixture, outline mode별 필수 항목, 미풀이 용어와 다중 이름 탐지를 확인한다.
- 비교 검증에서는 같은 입력 fixture를 넣고 현행 프롬프트와 반영안의 지표, findings, preservationCheck를 비교한다. 다만 실제 AI 비용이 드는 호출은 fixture 검증과 구분하여 기록한다.
- 독자 확인은 PILOT-001의 "독자 과업" 방식으로 진행하고, 실제 독자의 paraphrase를 최소 2회 반복한다(digital.gov). AI paraphrase는 대리 지표로만 쓴다.
- 지표가 좋아지더라도 목소리 보존이 떨어지거나 숙련 독자 대상 글이 장황해지면 해당 규칙을 철회한다.

## 미결정

- sectionModes 분류값 도입 여부
- 구간 카드 항목 필수화 범위
- 용어집 입력 경로(사용자 입력과 AI 추출 중 선택)
- 지표 경고의 UI 노출 여부
- ~~확인 질문을 본문에 포함할지, 검토용으로만 사용할지 여부~~ → ADR-0029에서 결정
