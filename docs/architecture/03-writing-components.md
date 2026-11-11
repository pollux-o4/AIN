# C3 · 편집 모듈·어댑터

- 계약: contracts/requests·ai-output·txt·runtime · 구조·필수 내용·입력 길이·TXT 형식의 단일 정의
- 도메인: editorial/domain/index → machine · `transition`·`nextAction`·`flowIssue`·`currentArtifact` · 순서·선행 결과·revision·승인
- 애플리케이션: editorial/index → service · lifecycle·actions·view · 요청 멱등성·AI 호출 한도·중단 확인·명시적 보완
- 저장·HTTP: editorial/store·http · SQLite·쿠키·worker 인증·Markdown·TXT · 추적은 monitor
- 화면: editorial/ui의 compose·workspace·tracking·shared · React·TypeScript · Vite·Tailwind · HTTP 계약만 사용
- AI 어댑터: paseo/index → Jobs·prompts · 공통 SDK 실행·결과 파싱·확인된 취소 · 편집 정책 소유 없음
- 전달 어댑터: n8n/editorialWorkflow · 작업 ID·continue·대기 · Code 노드 없음
- 에이전트 CLI: cli/ain → commands → client · HTTP 계약만 사용 · 토큰은 runtime/server가 생성 · AGENT-001
- 조립·기동: runtime/server·start · 모듈 생성·저장/실행/전달 포트 연결·자식 프로세스 생명주기
- 자산: Vite → `.local/editorial-web/` → editorial/assets · 동일 출처·CSP 유지
- 검증: ARCH-001·FLOW-001·TOOL-001 · 내부 구현 직접 참조와 역방향 의존은 dependency-cruiser로 차단
- 실시간: paseo/activity가 SDK 타임라인→공개 관측 변환 · editorial/service/activity가 편집 작업·회차 연결 · http-stream은 인증 후 SSE 전달·연결 해제만 담당 · n8n 변경 없음 · LIVE-001
- 이력 조회: editorial/service/history가 영속 사건·회차와 Jobs.describe를 결합 · Paseo는 promptContext 기반 실제 입력 종류와 허용 결과만 제공 · SSE·n8n 의존 없음 · HISTORY-001
