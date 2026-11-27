# MIG-001 · 이식 경계 확정과 병렬 작업 배정

선행 없음. 주 작업자가 공유 계약을 머지한 시점부터 계약에 의존하는 구현을 시작한다.

## 목표와 결정 기록

React/TypeScript UI와 기존 Node CLI는 Go의 로컬 HTTP API를 호출한다. Go 서버는 빌드된 UI를 같은 출처에서 제공하고, SQLite·작업 실행기·Paseo WebSocket 클라이언트를 한 프로세스에 둔다. Paseo 데몬과 agy는 외부 실행 환경으로 둔다. 서버 배포본은 UI 자산을 포함하며 AIN의 Node 서버와 n8n 설치 없이 기동한다. Node는 UI 빌드와 기존 CLI에 사용한다.

- `backend/` Go 모듈, 공유 타입·포트·fixture 인수 형식, Go 툴체인, SQLite 드라이버·CGO 및 배포 대상 OS/아키텍처, 공통 의존성 버전을 주 작업자가 확정한다.
- 새 runtime ADR을 proposed로 작성한다. 맥락·대안(Node 내부 실행기, JS SDK 상주 어댑터, Go 직접 연결)·선택·이유·결과를 기록한다. ADR-0002·0004의 대체 범위와 ADR-0001·0003·0005·0015에 미치는 영향을 확인한다.
- AIN-API-001·LIVE-001·ARCH-001·TOOL-001의 기존 ID를 유지한다. 새 실행 수명·이관·성능 계약에만 새 ID를 부여한다. 기준 계약으로 잡은 의도적 변경과 적용 조건은 명세에 기록한다.
- 기준 커밋 SHA와 Paseo 호환 버전을 고정한다. 계획 작성 때 `automation/paseo/jobs.mjs`에 로컬 변경이 있으므로 기준 커밋 선정 전에 반영 여부를 확인한다.

## 먼저 고정할 포트

아래 이름은 초안이다. 주 작업자가 Go 시그니처와 오류를 확정한다. 의존성은 HTTP → 앱 → 도메인·포트이며, 어댑터는 포트를 구현한다.

| 경계 | 메서드와 의미 |
|---|---|
| 편집 | `Reduce(state, event) → state`, `Next(state) → action`, `View(run) → view`. 글과 시각자료가 하나의 전이 진입점을 사용한다. 시각자료 순수 함수와 공통 출력 검증을 별도 포트로 둘 수 있다. |
| 저장 | `GetRun`, `FindRequest`, `ListSummaries`, `ScanPending`, `Reserve(expectedVersion, intent)`, `Bind(intentID, remoteRef)`, `Commit(expectedVersion, intentID, result)`. 충돌·미발견·중복·저장 불능을 구분하며 상태 변경과 멱등 키를 함께 저장한다. |
| 실행 | `Wake(runID)`, `Pause(runID)`, `Recover(ctx)`. 실행기는 영속 선점으로 중복 요청을 합치며 UI 구독과 독립적으로 작동한다. |
| Paseo | `Probe`, `Create(spec, agentID)`, `Send(agentID, turnRef, input)`, `Snapshot(agentID)`, `Watch(ctx, agentID, cursor)`, `Cancel(agentID)`, `Archive(agentID)`. 전송 확인 여부와 턴·세션 식별자를 전달한다. 재전송 가능 여부를 MIG-002 결과로 보강한다. |
| AI 입력·결과 | `BuildTurn(action, context)`와 `ValidateResult(action, result)`를 주입한다. 글·시각자료 담당의 분기는 조립 지점에서 연결한다. |
| HTTP·산출물 | 편집 서비스의 조회·변경·관측, 산출물의 `Read`·`Export`·`Handoff`를 주입한다. 외부 기준은 AIN-API-001·AGENT-001·LIVE-001과 기준 응답·헤더 fixture다. |

합성 fixture는 요청·응답·이벤트·시각·ID·파일 입력을 재현한다. 저장 JSON의 알 수 없는 필드, 누락과 null, 정수, 시간이 왕복 시 어떻게 보존되는지 정한다. 전송 오류는 현행 동작을 기준으로 확정 실패, 재조회 필요, 사용자 확인 필요를 구분한다.

## 병렬 배정

- 계약 전 3개 착수 가능: 주 작업자의 MIG-001, Paseo 담당의 MIG-002, 성능 담당의 MIG-051.
- 계약 머지 후 13개 작업에 착수 가능: MIG-003, MIG-011~014, MIG-021~025, MIG-031~033. MIG-013은 가짜 전송으로 먼저 시작하고 직접 연결은 MIG-002 결과를 기다린다. 합성 기준 fixture를 사용하는 최종 검증은 MIG-003 뒤에 한다.
- 동시 세션 수는 가용 워커·메모리 안에서 정한다. 우선순위는 Paseo probe, 저장·실행, 편집 순수 로직이다. HTTP·클라이언트는 가짜 포트로 병행한다. 실제 배선은 MIG-052가 맡는다. MIG-053의 이관 도구는 저장 계약이 고정되면 합성 데이터로 병행한다.

## 승인 순서

1. 공통 포트가 머지되면 개별 패키지 작업을 시작한다. Paseo 연결을 통과하면 전송 어댑터를 실제 프로토콜로 연결한다.
2. 독립 모듈의 기준 fixture 대조가 끝나면 통합 담당에게 인계한다. 통합·성능 검증을 통과한 후보로 합성 이관·복구를 연습한다.
3. 제품 배포 검증과 운영 데이터 전환은 각각 승인한다. 릴리스 구성은 MIG-054, 운영 전환과 복구는 MIG-053을 따른다.

## 충돌 방지와 인계

- 각 작업자는 같은 기준 커밋에서 분리한 worktree와 마일스톤의 전용 경로를 쓴다. 임시 DB·인증·outbox·빌드 출력은 작업별로 생성하고 테스트 포트는 동적으로 배정한다.
- `backend/internal/contract/`, `go.mod/go.sum`, `mise.toml`, `mise-tasks/`, 루트 설정은 주 작업자 또는 지정 통합 담당만 수정한다. 공통 fixture는 MIG-003 담당이 쓴다. 공유 계약 변경이 필요하면 영향받는 작업 ID와 함께 요청한다.
- 위임에는 작업 ID·전용 경로·고정 포트 계약·세부 작업 하나·성공 명령·커밋 금지를 명시한다. Luna high는 구현·최소 검증·보고를 10분 단위로 나눈다. 7분에 마무리 요청, 10분에 종료하고 잔여 작업을 별도 배정한다.
- 작업자는 수정 파일, 최소 검증 결과, 미완료·환경 차단을 보고한다. 주 작업자가 결과를 검수·병합한다. 모듈 완료 후 연결·E2E·전체 검증은 한 과업으로 위임하고 주 작업자가 판정한다.
- 공통 Paseo로 위임하는 경우 AGENTS의 무대기 실행을 사용하며 관찰 주소 `http://127.0.0.1:6767/`를 안내한다. 동일 제공자는 내장 서브에이전트를 우선한다.

완료 기준: 담당자가 다른 모듈 구현 없이 가짜 포트로 자신의 최소 검증을 시작할 수 있고, 각 공유 경로의 수정 담당이 한 명으로 지정되어 있다.
