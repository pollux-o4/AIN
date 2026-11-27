# MIG-031 · 로컬 HTTP·SSE와 UI 자산

선행 MIG-001 계약. 전용 경로 `backend/internal/httpapi/`. 가짜 편집 서비스와 산출물 포트로 시작한다.

1. `/write/` 정적 자산, `/write/api/runs` 계열, `/healthz`를 이식한다. `/write` 리다이렉트, MIME, CSP·보안 헤더, 요청 크기와 오류 상태를 기존 계약에 맞춘다.
2. loopback 바인딩, Host·Origin·SameSite·HttpOnly 검사와 CLI 전용 Bearer 인증을 이식한다. UI 서명 키와 CLI 토큰을 분리한다. 산출물 읽기와 SSE는 현행 구현과 명세를 대조해 인증 기대값을 고정한다.
3. 활동 SSE는 현재 스냅샷부터 전송하며 취소 때 구독을 닫는다. 느린 연결에는 크기·버퍼·수명을 제한하고 실행기에 역압을 전파하지 않는다.
4. n8n 내부 advance와 실행 링크를 폐기하는 계약을 적용한다. 구 UI 스키마는 `executionLinks: []`를 읽을 수 있게 한 뒤 MIG-033과 함께 필드 제거 여부를 확정한다. 과거 이력의 실행 ID는 보존한다.

완료 기준: 합성 HTTP·SSE fixture가 성공·오류·권한·교차 출처·연결 해제를 대조한다. raw 작업 경로와 구 내부 advance가 실행을 시작하거나 자격증명을 노출하지 않는다.

최소 실행: `go -C backend test ./internal/httpapi/...`와 경합·해제 사례의 `go -C backend test -race ./internal/httpapi/...`. 명령은 해당 패키지 구현 후 사용한다.

검증: AIN-API-001, AGENT-001, LIVE-001.
