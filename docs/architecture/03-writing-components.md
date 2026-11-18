# C3 · 편집 모듈·어댑터

## 계약·규칙

- 계약: contracts/requests·ai-output·txt·runtime은 구조, 필수 내용, 입력 길이, TXT 형식에 대한 단일 정의를 제공한다.
- 도메인: editorial/domain/index에서 machine으로 연결되며, `transition`·`nextAction`·`flowIssue`·`currentArtifact`를 통해 순서, 선행 결과, 회차, 승인을 판정한다.

## 서비스·저장·화면

- 애플리케이션: editorial/index에서 service(lifecycle·actions·view)로 연결되며, 요청 멱등성, AI 호출 한도, 중단 확인, 명시적 보완을 처리한다.
- 저장·HTTP: editorial/store·http가 SQLite, 쿠키, worker 인증, Markdown, TXT를 맡고, 상태 추적은 monitor가 담당한다.
- 화면: editorial/ui의 compose·workspace·tracking·shared는 React·TypeScript·Vite·Tailwind로 구성하며 HTTP 계약만 사용한다.
- 이력 조회: editorial/service/history가 영속 사건·회차와 Jobs.describe를 결합한다. Paseo는 promptContext 기반의 실제 입력 종류와 허용 결과만 제공하며, SSE와 n8n에는 의존하지 않는다(HISTORY-001).

## 외부 연결

- AI 어댑터: paseo/index에서 Jobs로 연결되며, prompts/(형식 틀·단계 정의·조립), seasoning(글쓰기 규칙), metrics(코드 지표), results(결과 파싱)로 구성한다. 공통 SDK 실행과 확인된 취소만 맡으며 편집 정책은 두지 않는다(ADR-0013).
- 전달 어댑터: n8n/editorialWorkflow는 작업 ID 전달, continue 호출, 대기를 담당하며 Code 노드를 두지 않는다.
- 에이전트 CLI: cli/ain에서 commands, client로 연결되며 HTTP 계약만 사용한다. 토큰은 runtime/server가 생성한다(AGENT-001).
- 실시간 관측: paseo/activity가 SDK 타임라인을 공개 관측 형식으로 변환하고, editorial/service/activity가 편집 작업과 회차를 연결한다. http-stream은 인증 후 SSE 전달과 연결 해제만 담당하며 n8n 변경은 없다(LIVE-001).

## 조립·검증

- 조립·기동: runtime/server·start가 모듈을 생성하고 저장·실행·전달 포트를 연결하며 자식 프로세스의 생명주기를 관리한다.
- 자산: Vite 빌드 결과는 `.local/editorial-web/`을 거쳐 editorial/assets에서 제공하며 동일 출처와 CSP를 유지한다.
- 검증: ARCH-001·FLOW-001·TOOL-001 기준을 따르며, 내부 구현의 직접 참조와 역방향 의존은 dependency-cruiser로 차단한다.
