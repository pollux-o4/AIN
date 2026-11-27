# MIG-053 · 오프라인 이관과 복구

Linux에서 실행한다. 운영 전환은 별도 승인 후 실시한다(OPS-001, OPS-003).

1. Node·n8n의 활성 작업을 정리하고 정상 종료한다. 자동 시작과 재시작을 차단하고 전환이 끝날 때까지 단일 작성자를 유지한다. `--offline`은 이 조건을 확인한 사람이 지정한다.
2. 비공개 상위 디렉터리에서 아래 명령으로 패키지를 준비하고 검증한다. 운영 기본 배치의 원본 루트는 `ai-runtime/`, `n8n/`, `outbox/`를 담는다. 사용자 지정 경로, 외부 DB, 이 루트 밖의 자격증명과 산출물은 오프라인 상태에서 별도 보존하고 경로를 대조한다.
3. 패키지를 비공개 증거로 보존하고 `candidate/`의 별도 복사본으로 조회를 시작한다. 목록 수, 최신·과거 원고, 승인, 그림, 기존 실행·사용량 기록을 대조한다. 보류 항목이 있으면 이전 원격 결과와 연결을 확인하기 전에는 해당 작업을 재개하지 않는다.

```sh
go -C backend run ./tools/migrate prepare --source /private/legacy-local --package /private/cutover --offline
go -C backend run ./tools/migrate verify --package /private/cutover
go -C backend run ./tools/migrate restore --package /private/cutover --target /private/rollback-copy --before-go-writes
```

| 보존 경계 | 패키지 |
|---|---|
| 글·회차·이력·보관·승인·기존 실행 ID | `backup/`은 SQLite와 기존 WAL·SHM을 그대로 보존한다. `candidate/`는 복사본에 Go 스키마를 적용한다. |
| 작업 ID·세션·사용량·결과·인계 | 기존 `jobs/`, 담당 등록부, 작업 폴더와 outbox는 원본 바이트를 보존한다. n8n 이력과 자격증명은 비공개 백업에 보존한다. |
| 원격 상태 확인 대기 | 기존 pending 및 job ID를 보존하고 새 Go 실행 의도는 만들지 않는다. 미확정 대기 글은 중단 상태와 `legacy_reconcile`로 표시한다. 매니페스트의 `holds`는 기존 연결, 누락 또는 종료 결과 검토를 구분한다. |
| 검증 | 파일 크기·SHA-256, 편집 DB 무결성, 실행 묶음 참조, 글 ID·회차와 변경 전후 레코드 해시를 기록한다. 같은 원본으로 재실행하면 검증된 패키지를 재사용한다. |

`prepare`는 실행 중인 기록, 인식한 로컬 서비스의 원본 사용 또는 복사 중 원본 변경을 발견하면 게시를 거부한다. 프로세스 시작 차단과 공개되지 않는 프로세스의 정지는 운영자가 보장한다. 매니페스트 및 백업에는 비공개 식별자·원고·토큰이 들어 있으므로 배포 파일에 포함하지 않는다.

Go 쓰기 전 복구는 검증된 `backup/`을 별도 대상으로 복원한 뒤 Node 기동 전에 파일과 실행 상태를 확인한다. 도구는 기존 대상에 변경이 있으면 덮어쓰지 않는다. Go 쓰기 후에는 Go를 정지하고 최신 데이터 복제본에서 복구한다. 검증된 역이관 없이 Node로 전환하면 Go에서 생긴 변경을 잃을 수 있다.

합성 기동 확인: 복제한 Node fixture의 작업 두 건 중 대기 작업 한 건을 확인 대기로 이관했다. `prepare`와 `verify` 결과가 일치했고, 후보 복제본에서 `editorial:start`와 CLI 목록을 실행해 중단 상태 한 건과 보관 자료 제외를 확인했다. 별도 복구본의 SQLite는 원본과 바이트 단위로 일치했다.
