# ADR-0008 · 편집장 = 편집 메모(입구) + 합격 판정(출구) · AIN 내부

- 맥락: 모호한 피드백을 첫 모델이 문자 그대로 처리("너무 길어" → 초고만 줄이기 → 8천 자 재작성 시간 초과) · 편집장이 대화 중 외부 에이전트일 때만 동작(ADR-0006) · 과제별 규칙을 늘리면 특정 요청에만 맞춰짐
- 근거: RES-006 실제 편집 협업(편집 메모·편집 수준·합격 기준)
- 선택:
  - 입구: 수정 위치 판단(route)을 편집 메모로 확장 · `{reason=의도, target, level, priorities, preserve, assumptions, acceptance{length, criteria}}` · 상태 `brief`
  - 범위: 편집 수준이 복귀 단계를 결정적으로 보정(`levelTarget`) · developmental은 늦어도 outline, line·copy는 draft
  - 출구: review가 메모 기준으로 `verdict`(pass|revise)·`reviseFrom`·`unmetCriteria` · 코드 가드(ADR-0007)와 같은 미충족 형식으로 합쳐 자동 재작성 상한 2회
  - 표시: 화면·CLI에 "수정 해석"(의도·우선순위·살릴 것·가정) · 사람 피드백은 승인 후 착수(ADR-0010)
- 이유: 대화 여부와 무관하게 같은 품질 루프 · 범용 양식이라 요청 종류(분량·톤·구조)에 무관 · 수정 회차마다 추가 AI 호출 없음(route 확장)
- ADR-0006 변경: 외부 에이전트는 루프 필수 단계가 아님 · 사람과 같은 입구로 요청하는 조언자 · 최종 검수는 계속 사람
- 관련: ADR-0007 · FLOW-002 · RES-006
