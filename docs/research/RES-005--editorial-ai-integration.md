# RES-005 · AIN 편집 AI 반영안

- 상태: 제안 · 구현·스키마 변경 미적용
- 관심사: RES-004 절차를 AIN 8단계 산출물·지표·규칙·피드백 루프·검증으로 옮기는 설계
- 관련: FLOW-002 진단·sectionModes·검토 · `automation/paseo/prompts.mjs` · `automation/contracts/ai-output.mjs` · PILOT-001 독자 과업
- 제약: FLOW-002 "개념 설명 순서의 일괄 강제 제외" 유지 · sectionModes는 현재 자유 문자열(예: `explanation`) · mode 이름(explain·procedure·argue·narrate)은 제안 분류
- 변경 이유: AIN 계약·단계 설계 변경

## 산출물 설계

### 감자 작성 방식 ↔ AIN 단계

| 감자 | AIN 단계 | 비고 |
| --- | --- | --- |
| 기출 분석으로 최소 범위 결정 | topic · value | 독자가 할 수 있게 될 일 기준 |
| 독자=비전공 수험생 고정 | diagnose · audience | readerLevel·오해 추가 |
| 출처·기출 확인 · "아직 확인되지 않음" 명시 | research | 기존 uncertainties 활용 |
| 템플릿 + 일관 비유 | outline | 설계 카드·비유 대응표 |
| AI 공동 초안 | draft | 규칙 강화 |
| 정답 공개 전 확인·연습 문제 | review(+ 선택 산출) | 확인 질문 |
| 댓글 제보 → 혼동 보정 로그 | feedback → route | 혼동 지점 단위 기록 |

### 단계별 산출물 제안

- 기존 8단계 유지 · 새 단계 없음

| 단계 | 현재 | 추가 제안 | 원칙 |
| --- | --- | --- | --- |
| diagnose | purpose·audience·sectionModes·preserveVoice·strategy | `readerLevel` · 구간 분류는 Diátaxis 두 질문(행동/인지 · 습득/적용)으로 판단 | P1 |
| audience | reader·intent | `knows[]` · `unknownTerms[]` · `misconceptions[]` · `homonyms[]` · `readerTask` | P1·P5 |
| value | outcome·preserve | outcome = 읽고 나서 할 수 있는 일 1문장 · 범위 밖 항목 `excluded[]` | P2 |
| research | evidence·uncertainties | 예시 값의 임의성·출제/근거 미확인 사실을 uncertainties에 기록 | P5 |
| outline | sections·rationale | `analogySystem{source, mapping[], limits[]}` · sections = `{title, mode, level, optional, prerequisite, keyPoint, concrete, walkthrough, refute, checkQuestion}` | P2~P6 |
| draft | text·changeSummary | draft 규칙 초안 · 소제목·캡션 결론형 · 용어 1대상 1이름 | P2~P5 |
| review | findings·preservationCheck | findings에 원칙 ID(P1~P6)·구간 표시 · `paraphrase`(핵심을 독자 말로 3문장 재진술 → 원문과 불일치 지점) · 측정값은 코드 제공값만 사용 | 전체 |

- explain 구간만 설계 카드 필드 필수 · 다른 mode는 `keyPoint`만 필수 (FLOW-002 일괄 강제 제외)
- readerLevel 높음: `concrete`·`walkthrough` 선택 · 풀이 밀도 축소
- 호환: 현재 `looseObject` 스키마라 필드 추가는 파싱 호환 · 필수화는 별도 결정

## 생성·검토 규칙

### 코드로 계산할 지표

- 용도: review 입력

| 지표 | 계산 | 용도 |
| --- | --- | --- |
| 문장 길이 중앙값·상위 10% | 문장부호 분리 · 공백 포함 유니코드 문자 수 | 긴 문장 후보 표시 |
| 문단 최대 길이 | 빈 줄 기준 | "글 벽" 후보 (F자 스캔 조건) |
| 소제목 수·간격 | 마크다운 제목 | layer-cake 스캔 지원 여부 |
| 미풀이 용어 | `unknownTerms` 첫 등장 문장에 괄호·정의 패턴 없음 | P1 |
| 다중 이름 후보 | 사용자 용어집 또는 `homonyms` 기준 | 용어 불일치 |
| 오해 반박 누락 | `misconceptions` 항목별 본문 대응 문장 유무(AI 판단 보조) | P5 |

- 기준값은 경고용 · 감자 실측(문장 중앙값 40~51자)은 참고 사례이지 표준 아님
- 기존 `draftCharacterCount`와 같은 방식: 수치는 코드, 해석은 AI

### draft 규칙 초안

- 적용: explain 구간

```text
- 첫 문단: 정의 1문장 + 이 글로 할 수 있게 될 일 + 다룰 개념 목록
- 근거가 확인되지 않은 중요도·출제·수치는 "확인되지 않음"으로 명시
- 비유는 outline.analogySystem 하나만. 새 비유 추가 금지. 맞지 않는 지점 1문장
- 구간마다 개념 1개: 정의 → 비유 대응 → 이유 → 따라가는 예제(단계 번호)
- misconceptions마다 "흔히 ~라고 생각하지만 ~" 반박 문단
- homonyms마다 "이름만 같고 대상이 다름" 구분 문장
- 소제목·그림 설명은 결론 문장으로
- 전문어 첫 등장 시 괄호 풀이. 같은 대상은 같은 이름
- optional 구간은 본문 흐름 밖(접기·"더 알아보기")에 배치
- 구간 끝 checkQuestion은 본문만으로 답할 수 있게
```

## 운영·검증

### 혼동 보정 루프

- 입력: 사용자 feedback

- 사용자 피드백을 "어느 구간·어떤 표현에서 무엇을 헷갈렸나"로 정규화 → route가 outline(구조) vs draft(표현) 선택
- 보정 이력을 revision마다 보존(현행 history) · 같은 오해가 반복되면 audience.misconceptions에 승격
- AI가 스스로 피드백·만족을 생성하지 않는 현행 원칙 유지

### 검증

- 단위: 지표 계산 fixture · outline mode별 필수 필드 · 미풀이 용어·다중 이름 탐지
- 비교: 같은 입력 fixture로 현행 프롬프트 vs 반영안 → 지표·findings·preservationCheck 비교 · 실제 AI 비용 호출은 fixture와 구분 기록
- 독자 확인: PILOT-001 "독자 과업" 방식 · 실제 독자의 paraphrase 최소 2회 반복(digital.gov) · AI paraphrase는 대리 지표일 뿐
- 중단 조건: 지표 개선이 목소리 보존 저하를 동반하거나 숙련 독자 대상 글이 장황해지면 해당 규칙 철회

## 미결정

- sectionModes 분류값 도입 여부 · 설계 카드 필드 필수화 범위 · 용어집 입력 경로(사용자 vs AI 추출) · 지표 경고의 UI 노출 · 확인 질문을 글에 포함할지 검토용으로만 쓸지
