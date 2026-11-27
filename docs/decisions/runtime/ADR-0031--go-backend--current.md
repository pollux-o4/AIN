# ADR-0031 · Go 백엔드에서 편집 실행과 저장을 맡긴다

- 맥락: AIN은 편집 정책과 상태를 Node에 두고 n8n으로 작업을 전달하고 재조회한다. 로컬 배포의 상주 프로세스와 완료 반영 지연을 줄인다.
- 대안: Node 내부 실행기로 통합하거나, Go 서버와 Node Paseo SDK 어댑터를 함께 운영하거나, Go에서 Paseo에 직접 연결할 수 있다.
- 선택: Go 서버에 HTTP·SSE, 편집 실행기, SQLite, Paseo WebSocket 연결을 둔다. Go 서버가 React 빌드 자산을 제공하며 기존 CLI는 로컬 HTTP 계약을 사용한다. 공통 Paseo 데몬과 제공자는 외부 실행 환경으로 유지한다.
- 이유: 편집 상태와 영속 작업의 작성자를 한 곳에 두고, UI 연결과 독립적으로 Paseo 이벤트에 반응한다. 서버 배포에 AIN의 Node 프로세스와 n8n이 필요하지 않다.
- 결과: 전송 결과가 불명확하면 기존 원격 작업을 먼저 확인한다. 기본 `editorial` 명령은 Go 서버를 사용한다. Node·n8n 기준 환경과 비공개 실행 이력은 운영 복구와 비교에 사용한다. 운영 데이터 적용은 MIG-053의 별도 이관 절차를 따른다. 모델 지시문의 원천은 Node 프롬프트 정의이며, Go는 그 추출본(`mise run go:prompts`)을 내장해 조립만 한다. `go:check`는 추출본이 최신인지와 Node 프롬프트와의 바이트 일치를 확인한다.
- 대체: ADR-0002, ADR-0004. React·Vite·Tailwind CSS와 TypeScript strict, Zod·Biome·dependency-cruiser·Knip·Playwright·axe를 화면과 개발 검증에 유지한다. 편집 규칙의 단일 진입점과 공개 HTTP 계약도 유지한다.
