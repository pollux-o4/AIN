# FLOW-002 · 편집 도메인·사용자 판단

- 현재 실행: EDIT-001의 편집 애플리케이션 · n8n은 작업 ID 전달·서버 continue 대기만 담당 · ADR-0004
- 내부 순수 계약: editorial/domain/index의 `transition(state,event)` → `{state,action}` · 외부 부작용 없음
- 단계: diagnose→topic→audience→value→research→outline→draft→review · 구조·필수 내용·현재 revision 선행 결과 검증 · FLOW-001
- 사용자 이벤트: start·feedback·complete_requirements·pause·resume·retry·satisfy·authorize_publication
- 실행 결과 이벤트: complete·route·fail · 사용자와 어댑터 역할 구분 · id·expectedVersion·revision 검증
- 수정: 현재 결과 이력 보존·revision 증가 → 라우팅 → 검증된 선행 결과만 재사용 출처와 함께 승계 → 이후 단계 재생성
- 반복: 사용자 요청으로만 진행 · AI가 만족·승인·발행을 결정하지 않음 · 실패/권한/예산/중단 불명확 시 사용자 확인
- 판단: awaiting_user → 사용자 satisfy → satisfied → 별도 authorize_publication → publication_ready · 실제 발행 없음
- 보완: 기존 축약·누락 결과는 보존 · 자동 새 호출 없음 · 명시적 보완과 중단 확인 후 전체 단계 실행
- 글 품질: 목적·독자·의미·목소리 유지 · 설명·서사·주장·절차에 맞는 구성 · 근거 없는 사실/출처·정확성 보증·독자 연구 주장 금지
- 근거: 사용자 제공 자료 중심 · 직접 확인 불가 내용은 uncertainties · URL 자체를 읽는 웹 조사와 실제 발행은 별도
- 상태·예산 정본: 편집 애플리케이션·SQLite · n8n의 원시 상태 봉투·상태 머신 포함·독립 예산 경로는 종료
- 이전 내부 HTTP /jobs·/exports·/providers: 410 · 사용자 경로는 AIN-API-001 · 제공자 조회는 공통 SDK CLI
- 검증: editorial-machine·service·prompts 단위 → 얇은 n8n 전달/대기 → HTTP fixture·PC/모바일 → 격리 실제 모델
