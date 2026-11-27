# AIN

AIN은 독립 글쓰기 자동화 도구이다. 글감 입력부터 초안 검토, 수정, 내보내기(TXT·HTML·ZIP)까지의 과정을 처리한다. Go 서버가 로컬 화면·API·SQLite·실행 복구를 맡고, 공통 Paseo 데몬에 직접 연결한다.

- 설치: `mise trust`, `mise install`, `mise run setup` 순서로 실행한다.
- AI 실행 도구: 공통 Paseo의 설치·인증·데몬 기동은 OPS-003을 따른다. Go 서버가 읽을 Paseo 홈은 `PASEO_HOME`으로 지정할 수 있다.
- 실행: `mise run editorial:start`로 기동하고 [글쓰기 화면](http://127.0.0.1:3230/write/)을 연다. `editorial:status`와 `editorial:stop`으로 상태 확인과 종료를 한다. AI 실행은 [Paseo 관찰 화면](http://127.0.0.1:6767/)에서 확인할 수 있다.
- 배포: 서버 패키지는 Go 바이너리와 빌드된 화면을 포함한다(MIG-054). 기존 Node·n8n 데이터가 있으면 MIG-053 절차를 먼저 따른다.
- 개발: `mise run editorial`로 서비스를 시작한 뒤, 별도 터미널에서 `mise run editorial:dev`를 실행하여 Vite 주소에서 같은 로컬 API를 사용한다.
- AI 대행: `mise run ain`을 통해 대화형 AI가 사용자 대신 작업을 의뢰·수정·삭제한다. 사용 절차는 스킬 `ain-write`와 AGENT-001을 따른다.
- 정적 검사: `mise run check`로 캐시를 활용해 TypeScript·Biome·dependency-cruiser·Knip·gitleaks 검사를 실행한다.
- 공개 전 검사: `mise run secrets`로 작업 트리와 Git 이력에 비밀값, 개인 이메일, 홈 경로, 전화번호가 포함되었는지 확인한다.
- 검증: 빠른 기본 검증에는 `mise run test`를, 커밋 전 검증에는 `mise run verify`를 사용한다. 모듈별 검증과 캐시 규칙은 `TEST-RUN`을 따른다.
- 문서 탐색: `docs/` 아래의 architecture, decisions, specs, operations 디렉터리에서 고정 ID로 검색한다.
- 공개 계약: `AIN-API-001`을 따르며, 구조는 C1·C2·C3, 데이터와 복구 절차는 OPS-001에서 확인한다.
- 필수 흐름: 8단계로 처리하며 현재 회차를 검증한다. 이전 부분 초안은 명시적 보완 절차를 거친다(`FLOW-001`).
- 제한 사항: AI 검토는 사실 보증과 별개이며, 따로 웹 조사나 실제 발행은 하지 않는다.
- 실제 계약 검증: `mise run ai:test:contract`는 합성 입력과 격리 데이터를 사용하여 비용이 발생하는 기본 모델 호출(상한 OPS-003)로 계약을 검증한다. 반복 평가는 `mise run ai:eval`로 실행한다.
