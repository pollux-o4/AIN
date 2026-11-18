# AGENT-001 · 에이전트 CLI

- 범위: 대화형 AI가 사용자 대신 글쓰기 작업을 의뢰·추적·수정·삭제 · 결정 ADR-0005
- 사전 조건: `mise run editorial:start` 기동 · 기동 시 `.local/ai-runtime/agent-token` 생성(0600, 없을 때만)
- 입력: `mise run ain -- <명령>` · list·show·history·new·wait·feedback·pause·resume·complete-requirements·download·export·delete
- 인증: `Authorization: Bearer <agent-token>` · 브리지 토큰과 분리 · Origin 헤더가 있는 요청은 토큰 무시하고 화면 쿠키 규칙 적용 · loopback 호스트만
- 기대 동작: AIN-API-001의 `/write/api` 계약을 그대로 호출 · 정책·검증은 서버 소유 · 변경 동작은 최신 version 조회 후 새 operation ID
- 출력: JSON 요약(상태·이슈·가능 동작, `--text`·`wait` 시 본문) · download는 TXT · export는 `--out` 파일 저장 후 경로 JSON(형식 ADR-0012) · 오류는 stderr JSON·종료 코드 1, 잘못된 명령 2
- 편집장 권한: ADR-0006 · 에이전트 요청은 `by: agent` 기록 · satisfy·authorize-publication·시각자료 요청·선택·확인(ADR-0011) 403 · `show`의 `figure`로 상태만 조회 · 사람 수정 요청의 해석은 검토 후 `approve-brief`·`revise-brief`(ADR-0010) · 에이전트 수정 지시는 해석 사전 승인(ADR-0010) · 사람 행동 없이 연속 수정·재해석 2회 초과 409
- 삭제: `POST /write/api/runs/:id/archive` · 목록에서 숨김 · 진행 중 409 · 원고·이력 보존 · EDIT-001
- 실패 복구: 연결 실패 시 기동 안내 · 409는 최신 조회 후 재판단 · `wait` 시간 초과는 작업에 영향 없음
- 완료 기준: automation/cli/tests의 `agent_001` · 잘못된 토큰 401·브라우저 Origin 거부·토큰 분리 강제·에이전트 actor 전달 · 편집장 권한은 editorial/tests/service의 `ADR-0006`
- 사용 절차: 프로젝트 스킬 `ain-write`
