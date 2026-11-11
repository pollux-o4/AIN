# AIN-API-001 · 공개 로컬 계약

- 범위: 독립 실행·입력·조회·결과 인계 · 결정 ADR-0001
- 사전 조건: 자체 의존성·공통 AI 도구·n8n 소유자 계정·브리지 자격증명 준비
- 실행 입력: AIN 작업 경로에서 `mise run editorial` · 소비 제품 경로 입력 없음
- 사용자 입력: `/write/`의 글감·원문·수정 의견 · source·idea 저장 · 출처 URL 자체 읽기 미지원
- 조회: `/write/api/runs`·`/write/api/runs/:id` · 같은 origin UI 세션 또는 에이전트 토큰(AGENT-001)
- 삭제: `POST /write/api/runs/:id/archive` · 목록 숨김·원고 보존 · 진행 중 409 · EDIT-001
- 변경: 요청 ID·operation ID·expectedVersion · 중복 요청 동일 작업 회수·충돌 409
- 내부 계약: 인증된 n8n worker의 `/editorial/runs/:id/advance` · 실행 ID·실제 상태 저장 · 브리지 토큰 외부 노출 금지
- 출력: 검토용 TXT · revision별 보존 · 저장·검토·만족·발행 승인 구분
- 실패 복구: 동일 작업 재연결 · 불확실한 AI 생성·중단은 확인 전 재생성 금지 · OPS-001
- 완료 기준: 단독 단위·격리 런타임·브라우저 과업 검증 · boundary.test가 외부 제품 역의존 차단
- 변경 동작: feedback·pause·resume·complete_requirements·satisfy·authorize_publication · expectedVersion과 operation ID 필수
- 조회 추가: needsCompletion·completionReason·canCompleteRequirements·artifacts·canSatisfy·canAuthorizePublication · 단계 산출물·판단 가능 여부
- 사용자 다운로드: 기존 부분 초안·과거 revision도 원고 보존 목적으로 제공 · 보완 필요 여부·검토 여부와 구분
- 내부 원시 실행 경로 /jobs·/exports·/providers는 410 · 모든 실행은 영속 편집 작업과 인증된 advance 경로로 연결 · ARCH-001
- 실시간 관측: `GET /write/api/runs/:id/activity` · 동일 출처 UI 쿠키 · SSE `activity` 이벤트의 전체 스냅샷 · revision·stage·name·active·phase·text·truncated·lastOutputAt · activity 계약 정본 · LIVE-001
- 재접속: 이벤트 ID 재생 대신 현재 회차·작업의 타임라인 스냅샷 반환 · 완료 여부는 기존 편집 조회 정본 · 연결 해제 시 구독 해제 · 실행·편집 전이 없음
- 작성·수정 과정: `GET /write/api/runs/:id/history` · 동일 출처 UI 인증 · history 계약 정본 · journey는 작성 방향·수정 요약·확인할 점, records는 문제 진단용 근거 · HISTORY-001
