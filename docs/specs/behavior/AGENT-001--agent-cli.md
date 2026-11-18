# AGENT-001 · 에이전트 CLI

- 범위: 대화형 AI가 사용자 대신 글쓰기 작업을 의뢰하고 추적·수정·삭제한다(결정: ADR-0005).
- 사전 조건: `mise run editorial:start`로 서비스를 기동한다. 이때 `.local/ai-runtime/agent-token` 파일이 없으면 권한 `0600`으로 생성한다.
- 입력: `mise run ain -- <명령>` 형식으로 실행한다. 지원 명령은 `list`, `show`, `history`, `new`, `wait`, `feedback`, `pause`, `resume`, `complete-requirements`, `download`, `export`, `delete`이다.
- 인증: loopback 호스트에서만 허용하며, `Authorization: Bearer <agent-token>` 헤더를 사용한다. 에이전트 토큰은 브리지 토큰과 분리한다. 다만 `Origin` 헤더가 있는 요청은 토큰을 무시하고 화면 쿠키 규칙을 적용한다.
- 기대 동작: AIN-API-001의 `/write/api` 계약을 그대로 호출하며, 정책과 검증은 서버가 맡는다. 상태를 바꾸는 동작은 최신 version을 조회한 뒤 새 operation ID로 요청한다.
- 출력
  - 일반 출력은 상태, 이슈, 가능한 동작을 담은 JSON 요약이며, `--text` 옵션을 주거나 `wait` 명령을 쓰면 본문을 함께 출력한다.
  - `download`는 TXT 형식으로 출력하며, `export`는 `--out`으로 지정한 파일에 저장한 뒤 경로를 JSON으로 출력한다(형식: ADR-0012).
  - 오류가 발생하면 stderr에 JSON을 출력하고 종료 코드 1을 반환한다. 다만 잘못된 명령이면 종료 코드 2를 반환한다.
- 편집장 권한(ADR-0006)
  - 에이전트 요청은 `by: agent`로 기록한다.
  - `satisfy`, `authorize-publication`이나 시각자료 요청·선택·확인(ADR-0011)을 호출하면 403을 반환한다. `show`의 `figure`로는 상태만 조회할 수 있다.
  - 사람이 요청한 수정 해석은 검토한 뒤 `approve-brief`나 `revise-brief`로 처리하며, 에이전트가 지시한 수정은 해석을 미리 승인한다(ADR-0010).
  - 사람 행동 없이 연속 수정이나 재해석이 2회를 초과하면 409를 반환한다.
- 삭제: `POST /write/api/runs/:id/archive`를 호출해 목록에서 숨긴다. 다만 진행 중이면 409를 반환하며, 원고와 이력은 보존한다(EDIT-001).
- 실패 복구: 연결에 실패하면 서비스 기동을 안내한다. 409를 받으면 최신 상태를 다시 조회해 판단한다. `wait`의 시간 초과는 작업에 영향을 주지 않는다.
- 완료 기준: `automation/cli/tests`의 `agent_001`에서 잘못된 토큰에 401을 반환하는지, 브라우저 Origin을 거부하는지, 토큰 분리가 강제되는지, 에이전트 actor가 전달되는지 검증한다. 편집장 권한은 `editorial/tests/service`의 `ADR-0006`으로 검증한다.
- 사용 절차: 프로젝트 스킬 `ain-write`를 따른다.
