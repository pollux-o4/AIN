# MIG-051 런타임 기준선

Linux에서 프로젝트 도구와 의존성을 준비한 뒤 실행한다. 실행마다 새 임시 SQLite 저장소와 루프백 포트를 사용한다. Node+n8n은 n8n 포트 및 다음 번호의 브로커 포트를 점유한다.

```sh
mise exec -- node tests/migration/perf/measure.mjs --runs 3 > /tmp/ain-node-perf.json
mise exec -- node tests/migration/perf/measure.mjs --runs 3 --adapter /absolute/path/go-perf-adapter.mjs > /tmp/ain-go-perf.json
```

같은 호스트에서 순차 실행하고, CPU·커널·로그 수준·반복 횟수·이력 크기가 같은 보고서를 비교한다. 기본 부하는 매 회 새 글 하나, 동시 글 네 개와 앞 글의 SVG 두 장 묶음, 전체 세션 정리, 이력 250건(건당 128 KiB 규모)을 채운 뒤 대기 글 네 개 복구다. 목록 캐시를 비운 첫 조회와 다음 다섯 조회를 구분한다. 재시작 지연은 SQLite 재개방부터 네 대기 글의 시작 시 재전달까지다.

- 지연은 합성 완료 신호 → 첫 완료 상태 확인 → 편집 SQLite 저장 반환 → 조회 응답의 완료 이벤트까지 분리한다. 그림 묶음은 마지막 자식의 완료 신호와 확인을 사용한다. p50·p95는 최근접 순위로 계산한다. 조회 관측에는 25 ms 조회 간격이 포함된다.
- Node 기준은 편집 서비스·저장소·Jobs와 n8n 운영 전달 간격을 사용한다. 합성 세션은 시작 후 75 ms에 완료 신호를 내고, 신호 전 상태 확인에는 즉시 대기를 반환한다. Paseo RPC와 제공자 계산은 이 부하에 포함되지 않는다. 합성 세션은 재사용 제공자 정책에서 제외되어 새 작업마다 생성되며 실행 종료 후 보관된다.
- Linux `/proc`에서 프로세스별 RSS와 읽을 수 있는 PSS를 수집한다. AIN과 n8n 하위 프로세스를 AIN 소계로 묶고, 합성 실행에서 시작하지 않은 Paseo·agy 및 적용되지 않는 goroutine은 `null`로 표시한다. 단계별 메모리는 500 ms 표본 중 합산 RSS가 가장 큰 시점이다.
- 브라우저는 편집기를 빌드한 상태에서 `--browser`를 추가해 별도 실행한다. 브라우저 자체의 완료 조회 JSON 처리부터 편집 결과 DOM이 생긴 뒤 첫 화면 갱신 콜백까지 잰다.
- ADR-0015의 실제 제공자 이력은 2026-11-17에 종료된 검증 담당 대기 세션 158개와 제공자 프로세스 약 8.1 GiB를 관측한 기록이다. 이번 합성 기준선에는 더하지 않는다.

## 후보 연결

`--adapter`는 `start(config)`를 내보내는 모듈을 별도 자식 프로세스에서 연다. 설정은 `{root, n8nPort, historyCount, historyBytes, logLevel, completionDelayMs}`다. 모든 시험 데이터는 `root` 안에 쓴다. 편집기 HTTP API와 브라우저 세션 발급 경로를 독립 루프백 포트에 연다. Node와 동일한 합성 답변을 사용한다(`fixtureReply`). 프로필은 비교 실행과 별도의 로컬 진단에서 수집한다.

| 반환 항목 | 계약 |
|---|---|
| `url, pid, runtime, diagnostics` | 루프백 API 주소, 측정할 AIN 프로세스 루트, 런타임 이름, 로그 수준(`error`) 및 후보 실행 설정 |
| `extraRoots` | 별도 합성 프로세스가 있는 경우 `{pid, group}` 목록. `group`은 `paseo` 또는 `agy` |
| `counts()` | `{goroutines, subscriptions, runningSessions, idleSessions}` |
| `traces()` | 조회 응답 `monitor.events`의 완료 `jobId`별 `{signal, checked, saved}`. 단위는 호스트 epoch 기준 밀리초 |
| `clean()` | 진행 종료 후 모든 대기 세션을 정리하고 결과 반환 |
| `seedAndRecover(completedId)` | 지정 크기의 합성 이력과 대기 글 네 개를 저장한 뒤 재개하고 `{recoveryMs, databaseBytes, ids}` 반환 |
| `stop()` | 해당 시험의 프로세스와 연결 종료 |

비교 초안 목표는 동시 부하의 완료 신호 → DB 저장 p95 250 ms 이하, AIN 유휴 메모리 Node+n8n 대비 50% 이하, 종료 정리 후 세션·구독 0개다. 시험은 비교 초안 목표를 성공 조건으로 사용하지 않는다.
