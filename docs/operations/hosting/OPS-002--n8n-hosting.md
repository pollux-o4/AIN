## OPS-002 · 레거시 n8n 자체 호스팅

이 문서는 Node·n8n 기준 환경의 재현과 비공개 실행 이력 복구에 사용한다. 보관한 n8n DB와 암호화 키는 함께 보존한다. Go 전환 절차는 MIG-053을 참조한다.

- 목적: 블로그 글의 검토와 수정을 조정하는 n8n 상태 머신을 구축한다.
- AI 실행 공통 도구: `../paseo/`의 Paseo CLI·SDK 0.13.1을 사용하며 프로젝트별 별도 설치는 하지 않는다.
- PATH: `~/.local/bin/paseo`가 `DevRoom/paseo/bin/paseo`를 가리키도록 두어 호출 프로젝트의 작업 경로를 유지한다.
- 공통 설정·세션·캐시: `DevRoom/paseo/.local/home/`에 저장한다.
- 책임 분리: 편집 서비스와 순수 상태 머신은 글 계약·승인·TXT를 맡고, n8n은 요청 전달과 대기를 처리하며, 공통 Paseo는 AI 실행을 담당한다.
- 연결 안내: 연결 절차는 OPS-003을 참조한다. Argon 한도 오류 발생 사실과 Flash Medium 파일럿의 TXT 생성 확인 결과는 PILOT-001에 기록되어 있다.
- 도구 설정: n8n Community 2.44.6을 mise의 독립 npm 도구로 구성하며, 프런트엔드 의존성과 분리한다.
- 설치 경로: mise 기본 설치기는 `@pinecone-database/pinecone@5.1.2`의 provenance 누락으로 설치를 차단하므로, 공식 저장소의 release 커밋과 npm tarball SHA-512를 확인한 뒤 npm CLI backend를 사용한다.
- 재설치: `MISE_NPM_SHELL_OUT=true mise install npm:n8n@2.44.6`으로 설치한다. 이 실행에서는 mise provenance 하향 검사를 적용하지 않고 npm 배포 무결성 검사를 사용한다.
- 런타임: 기존 mise Node.js 24.12.0을 사용하여 패키지 요구 조건(Node.js 24 이상)을 충족한다.
- 설치 검증: 2.44.6 설치와 SQLite native 의존성 rebuild를 완료하였고, `/healthz` 정상 응답과 브라우저 `/setup` 최초 계정 화면을 확인하였다.
- SQLite native 모듈 누락 시 조치: `mise exec -- npm rebuild sqlite3 --prefix "$(mise where npm:n8n)/lib/node_modules/n8n"`을 실행한다.
- 실행 및 종료: 설치는 위 재설치 명령을 참조하고, 실행은 `mise run n8n`, 종료는 터미널에서 `Ctrl+C`를 사용한다.
- 접속: 루프백 바인딩 주소 `http://localhost:5678`로 접속하며, 최초 접속 시 소유자 계정을 생성한다.
- 데이터: SQLite, 워크플로, 자격증명 암호화 키를 `.local/n8n/.n8n/`에 저장하며 Git 추적에서 제외한다.
- 백업: n8n을 종료한 뒤 데이터 디렉터리 전체를 비공개로 백업하며, DB와 암호화 키를 함께 보관한다. 업그레이드 전에도 백업한다.
- 시간대: `Asia/Seoul`을 사용하며, 스케줄 실행을 위해서는 n8n 프로세스를 상시 가동하여야 한다.
- 라이선스: 개인 및 내부 업무 자동화 용도의 무료 Community(Sustainable Use License)를 사용하며, 서버와 외부 API 비용은 별도이다.
- 상시 운영 시 구성: 상시 운영을 선택할 때에는 Docker Engine + Compose, 영속 볼륨, HTTPS 리버스 프록시를 구성하고 인증·백업·복구 절차를 확인한다.
- 현재 범위: 로컬 글쓰기 화면, 영속 편집 서비스 `EDIT-001`, n8n 요청 전달·대기, Paseo AI 실행까지 포함하며, 실제 발행·Docker·공개 서버·도메인·TLS는 구성하지 않았다.
- 상태 전이: `editorial/domain/index`가 목적별 진단·편집·검토·사용자 피드백 분기를 처리하며, 만족 확정과 발행 승인을 분리한다.
- 검증: 논리 검증은 `mise run test:n8n`, n8n 격리 검증은 `mise run test:n8n:runtime`으로 실행한다.
- 워크플로: build-editorial-workflow가 생성하며 작업 ID 전달과 서버 continue 대기를 맡는다(ARCH-001).
- shortcut: Python task runner 가상환경을 구성하지 않아 Python Code 노드 실행은 검증하지 않았으므로, Python 처리 단계를 도입할 때에는 외부 task runner를 구성한다.
- shortcut: 로컬 워크플로 구성을 위해 npm 설치 방식을 사용하였으나 공식 문서상 n8n 3.0부터 npm 방식이 폐기될 예정이므로, 3.x 업그레이드 또는 상시 서버 운영 전에는 Docker Compose로 전환한다.
- 발행 연결: n8n은 스케줄과 워크플로 조정을 담당하며, 티스토리 편집과 검증은 별도 Playwright 연동 대상으로 둔다.
- 발행 범위: 글 준비·승인과 실제 발행을 구분하며, 실제 발행 워크플로, 중복 방지, 결과 검증은 구현하지 않았다.
- 공식 근거: [npm 설치](https://docs.n8n.io/hosting/installation/npm/), [Docker 설치](https://docs.n8n.io/hosting/installation/docker/), [라이선스 안내](https://support.n8n.io/article/can-i-use-your-license-for-my-use-case) 문서를 참조한다.

