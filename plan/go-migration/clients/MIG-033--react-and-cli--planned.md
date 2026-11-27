# MIG-033 · React·CLI의 Go API 전환

선행 MIG-001 계약. 전용 경로 `automation/editorial/ui/`, `automation/cli/`, `vite.config.ts`. 테스트는 해당 모듈 전용 경로에 둔다.

1. 기존 클라이언트의 상대 경로 API와 SSE를 유지한다. Go 응답 fixture에 맞춰 n8n 링크와 상태 표시 의존을 제거하고 AIN 이력·작업 상태는 유지한다.
2. Vite 빌드에 있는 `../paseo/endpoint.mjs` 직접 의존과 `__PASEO_URL__` 사용처를 확인한다. 유지할 데몬 링크가 있으면 계약으로 넘겨 빌드 시 공통 설치 경로 읽기를 없앤다. Go가 배포에 사용할 UI 자산 경로는 계약에 따른다.
3. CLI 엔드포인트·토큰 경로·동작·종료 코드·내보내기 호환을 확인한다. `mise run ain -- …` 진입점 조립은 통합 담당에게 전달한다.

완료 기준: fixture 서버에서 화면·CLI 모두 읽기와 변경을 수행한다. 화면 재연결 후 이전 회차 이벤트가 섞이지 않는다. 제품 UI 빌드가 로컬 Paseo 설치나 n8n 설정 없이 완료된다.

최소 실행: `mise run build`, `mise run test:cli`, 합성 Go 응답을 주입한 화면 상태·재연결 시험.

검증: AIN-API-001, AGENT-001, LIVE-001, HISTORY-001.
