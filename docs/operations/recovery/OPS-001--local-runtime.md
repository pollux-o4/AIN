# OPS-001 · 설치·기동·복구

- 개발 설치: Go·Node·pnpm은 mise 설정을 사용한다. `mise run setup`으로 프런트엔드와 Go 실행 파일을 빌드한다. 배포본의 기동 방법은 MIG-054 패키지 안내를 참조한다.
- 공통 AI 환경: 제공자 인증과 Paseo 기동은 OPS-003을 따른다. AIN은 공통 Paseo를 종료하지 않는다.
- 기동: `mise run editorial:start`는 백그라운드로 시작한다. 포그라운드에서 사용할 때는 `mise run editorial`을 실행한다. 기본 브라우저 주소는 `http://127.0.0.1:3230/write/`이다.
- 확인: `mise run editorial:status`와 `GET /healthz`로 상태를 확인한다. 새 버전 적용은 `editorial:restart`를 사용한다.
- 종료: `mise run editorial:stop`은 같은 데이터 디렉터리를 사용하는 소유 Go 프로세스만 정상 종료한다. 영속 AI 작업이 있으면 거부한다. `--force`는 사용자 확인 후 사용하며 기존 작업의 원격 연결은 보존한다.
- 설정: `AIN_DATA_DIR`은 편집 DB와 실행 기록, `AIN_OUTBOX`는 승인된 인계, `AIN_GO_CONTROL_DIR`은 로컬 프로세스 기록과 로그를 지정한다. `AIN_LISTEN`으로 루프백 포트를 바꿀 수 있다. 운영 DB와 자격증명은 비공개 권한을 유지한다.
- 브라우저 검증 준비: `pnpm exec playwright install chromium`으로 잠금 파일의 Chromium 버전을 설치한다.
- 레거시: 이관 전 기존 쓰기 프로세스는 `editorial:legacy:status`와 `editorial:legacy:stop`으로 확인·정지한다. n8n 기록 보존은 OPS-002를 따른다.

## Go 후보 이관과 복구

- 원본 반영은 별도 운영 이관으로 승인받는다. 활성 작업을 확인하고 기존 작성자와 자동 재시작을 정지한 뒤 MIG-053으로 비공개 백업과 후보를 만든다. n8n 실행 DB와 키도 함께 보존한다(OPS-002).
- `prepare`와 `verify`가 모두 성공한 패키지에서 후보를 다시 복제하여 Go에 연결한다. 운영 쓰기 전에 목록, 회차별 원고·승인, 그림, 이력과 사용량을 조회해 원본과 대조한다. `legacy_reconcile` 작업은 기존 Paseo 세션과 결과를 확인할 때까지 보류한다.
- Go 쓰기 전에는 `restore --before-go-writes`로 검증된 Node 백업을 별도 디렉터리에 복원할 수 있다. Go 쓰기 후에는 Go를 정지하고 최신 Go 데이터 복제본에서 복구한다. Node 재기동은 Go 변경을 보존하는 역이관을 검증한 경우에만 가능하다.
