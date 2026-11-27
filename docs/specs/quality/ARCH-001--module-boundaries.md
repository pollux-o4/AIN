# ARCH-001 · 모듈러 모놀리스·의존 방향

## Node 기준 환경과 클라이언트
- 모듈 구성
  - `contracts`: 입출력 계약을 정의한다.
  - `editorial`: 편집 도메인, 애플리케이션, 저장, HTTP, 화면을 맡는다.
  - `paseo`: AI 실행 어댑터를 둔다.
  - `n8n`: 전달과 대기 어댑터를 둔다.
  - `runtime`: 모듈 조립과 기동을 맡는다.
  - `cli`: 에이전트용 HTTP 클라이언트이다(AGENT-001).
- 공개 진입점: `editorial/index`, `editorial/domain/index`, `paseo/index`, `n8n/editorialWorkflow` 생성기만 외부에 연다. 다른 모듈의 내부 파일은 직접 참조하지 않는다.
- 편집 도메인: 순서, 회차, 선행 결과, 만족, 승인 규칙을 순수 전이로 처리한다. UI, DB, 네트워크, Paseo, n8n에는 의존하지 않는다.
- 편집 애플리케이션: 영속 상태, 예산, 멱등 요청, 중단 확인, 복구를 처리하며, 저장·AI 실행·전달 포트를 생성자로 주입받는다.
- 화면: 사용자 명령, 조회, 표시만 맡는다. 도메인 실행 코드나 Node, 저장소, 실행 어댑터는 import하지 않는다.
- n8n: 작업 ID를 전달해 인증된 advance를 호출하고, 서버의 `continue` 값에 따라 대기한다. Code 노드나 상태 전이, 예산, 모델, 승인 정책은 두지 않는다.
- Paseo: 제공자 발견, 명시적 모델 실행, 작업 결과와 중단 확인을 맡는다. 편집 애플리케이션과 저장소 내부를 참조하지 않는다.
- runtime: 모듈, 포트, 프로세스 생명주기를 조립하며 편집 정책은 구현하지 않는다.
- cli: `/write/api` 호출과 출력 형식만 처리하며, `contracts` 외에는 의존하지 않는다(AGENT-001).
- 검사: dependency-cruiser로 역방향 의존, 내부 참조, 순환 참조, 브라우저 Node 규칙을 검사하고, `architecture.test`로 실제 위반 주입을 검증한다. n8n workflow 검증으로는 Code 노드 사용과 도메인 복제를 막는다.

## Go 실행 경계

- C2와 C3는 ADR-0031 구성의 프로세스와 편집 모듈을 정의한다.
- `contract`는 다른 내부 패키지에 의존하지 않는다. `writing`과 `figuredomain`은 순수 편집 규칙에만 의존하며 `paseowire`는 내부 계약만 참조한다.
- `TestARCH001CorePackageBoundaries`에서 네 패키지의 내부 import를 검사한다. 기존 JS 경계 검사는 위 레거시와 클라이언트 모듈에 적용한다.
