# AIN-API-001 · 공개 로컬 계약

- 범위: 독립 실행, 입력, 조회, 결과 인계 계약을 정의한다(ADR-0001, ADR-0031).
- 사전 조건: Go 실행 파일과 빌드된 화면을 준비한다. AI 작업에는 공통 Paseo 데몬과 제공자 인증이 필요하다.
- 실행 입력: AIN 작업 경로에서 `mise run editorial`을 실행한다. 소비 제품 경로는 입력받지 않는다.
- 사용자 입력: `/write/`에서 글감, 원문, 수정 의견을 입력받아 `source`와 `idea`를 저장한다. 출처 URL 자체를 읽는 기능은 지원하지 않는다.
- 조회: `/write/api/runs`와 `/write/api/runs/:id`로 조회한다. 같은 origin의 UI 세션이나 에이전트 토큰(AGENT-001)으로 인증한다.
- 삭제: `POST /write/api/runs/:id/archive`를 호출해 목록에서 숨기며 원고는 보존한다. 다만 진행 중이면 409를 반환한다(EDIT-001).
- 변경: 요청 ID, operation ID, `expectedVersion`을 사용한다. 중복 요청이면 같은 작업을 반환하고, 충돌이 발생하면 409를 반환한다.
- 내부 계약: Go 실행기는 작업 의도와 Paseo 세션·턴 연결을 저장하고, 확인된 현재 턴 완료만 편집 상태에 반영한다. 로컬 상태 확인은 `GET /healthz`를 사용한다.
- 출력: 검토용 TXT를 회차별로 보존한다. 저장, 검토, 만족, 발행 승인은 구분한다.
- 실패 복구: 같은 작업에 다시 연결한다. AI 생성이나 중단 상태가 불확실하면 확인하기 전에 다시 생성하지 않는다(OPS-001).
- 완료 기준: 단독 단위 검증, 격리 런타임 검증, 브라우저 과업 검증을 거치며, `boundary.test`로 외부 제품 역의존을 막는다.
- 변경 동작: `feedback`, `pause`, `resume`, `complete_requirements`, `satisfy`, `authorize_publication`을 호출할 때는 `expectedVersion`과 operation ID가 필수이다.
- 조회 추가: `needsCompletion`, `completionReason`, `canCompleteRequirements`, `artifacts`, `canSatisfy`, `canAuthorizePublication` 필드로 단계 산출물과 판단 가능 여부를 제공한다.
- 사용자 다운로드: 기존 부분 초안과 과거 회차도 원고 보존 목적으로 제공한다. 다만 보완 필요 여부나 검토 여부와는 구분한다.
- 내부 원시 실행 경로: `/jobs`, `/exports`, `/providers` 경로는 410을 반환한다. 모든 실행은 영속 편집 작업으로 요청한다(ARCH-001).
- 실시간 관측: `GET /write/api/runs/:id/activity`는 동일 출처 UI 쿠키로 인증하며, activity 계약의 정본이다(LIVE-001). SSE `activity` 이벤트로 `revision`, `stage`, `name`, `active`, `phase`, `text`, `truncated`, `lastOutputAt`을 포함한 전체 스냅샷을 전송한다.
- 재접속: 이벤트 ID 재생 대신 현재 회차와 작업의 타임라인 스냅샷을 반환한다. 완료 여부는 기존 편집 조회 정본으로 확인하며, 연결이 끊기면 구독을 해제하고 실행이나 편집 전이는 일으키지 않는다.
- 작성·수정 과정: `GET /write/api/runs/:id/history`는 동일 출처 UI 세션 또는 에이전트 토큰으로 인증하며, history 계약의 정본이다(HISTORY-001). `journey`에는 작성 방향, 수정 요약, 확인할 점을 담고, `records`에는 문제 진단용 근거를 담는다.
