# ADR-0016 · 요구는 요구 장부 하나가 원천

- 맥락: 사용자 "글자 수는 상관없다" 뒤에도 3,000~4,000자 상한이 수정 해석·분량 가드에 남음(2026-11-17 실측)
- 원인(SSoT·SOLID): 요구가 `idea`·`direction`·`feedback`·`brief.acceptance`·`requirements()`에 흩어짐 · 지금 유효한 값을 정하는 곳 없음 · 분량 검사(`required`)가 원천 우선순위까지 소유(SRP) · 의뢰 값이 영구 최우선 · "해제"를 담을 표현 없음 · 새 종류마다 원천 사슬·프롬프트 수정(OCP) · 프롬프트 신뢰 경계가 모든 원천을 같은 무게로 나열
- 대안: 분량 칸 3상태(분량만 고침·같은 구멍 반복) / 프롬프트에 우선순위 문구만 추가(코드 가드와 어긋남) / 요구 장부
- 선택: 요구 장부(이벤트 기록 → 항목별 최신 값 접기)
  - 기록 `state.requirementLog[]`: `{revision, source(form|idea|feedback), changes[{kind, op(set|lift), value?, quote}]}` · 접은 결과 `standing(state)`가 유일한 "지금 유효한 요구"
  - 쓰는 곳: 의뢰 화면·CLI 선택값(코드, form) · 글감 문장(진단 AI, idea, 한 번) · 사람 피드백(편집 메모 AI, feedback, 해석 승인 시 반영) · 자동 보정 지시는 쓰지 않음
  - 뜻 해석은 LLM(“상관없다” → lift) · 사람이 해석 확인 단계(ADR-0010)에서 변경분을 봄 · JUDGE-001
  - 종류 등록 `contracts/requirements.mjs`(값 형식·표시) · 코드 검사는 종류별 전략 등록(`domain/requirements.mjs` `CHECKS`) · 검사기 없는 종류는 검토 점검표 R
  - 프롬프트: `requirements`(장부)가 유일한 요구, 원문(idea·feedback)은 배경 · 부딪히면 장부가 이김
  - 이전 상태: 장부 없는 글은 첫 전이에서 이전 규칙(의뢰 값 → 편집 메모 분량 → 피드백·글감 문장)으로 한 번 만듦(`domain/legacy-requirements.mjs`)
- 결과: 새 요구 종류 = 등록 1건(+셀 수 있으면 검사기 1건) · 분량 전용 분기·문장 정규식 파싱 제거(이전 글 변환에만 남음) · 진단·화면의 서술 방식·독자 수준도 장부 값 우선
- 대체: ADR-0007의 "요구 원천" 항목 · 관련: ADR-0007 · ADR-0008 · ADR-0010 · JUDGE-001
