# MIG-002 · Paseo 직접 연결 가능성 확인

선행 없음. 전용 경로 `backend/tools/paseoprobe/`. 기준은 로컬 공통 Paseo 0.17.5의 client·protocol·server와 AIN의 `connectLocalPaseo`, `Jobs`, `RoleSessions` 호출이다.

1. 데몬 주소, loopback WebSocket 연결, local credential 조회·협상, 인증 실패 구분을 조사한다. 자격증명의 출처만 기록한다.
2. 생성·추가 턴·조회·타임라인 구독·모델/사고 단계 변경·취소·보관의 메시지, 상관 ID, 상태·완료와 순번 관계를 합성 transcript로 만든다. 완료 직전 단절 후 스냅샷으로 복구하는 경우를 포함한다.
3. 생성과 전송의 응답 유실을 나눠 확인한다. 사전 agent ID로 기존 생성 여부를 조회할 수 있는지, 재사용 세션의 같은 턴 전송이 멱등인지, epoch 변경 시 어디까지 확인 가능한지 기록한다.

최소 실행: `go -C backend test ./tools/paseoprobe/...`와 실데몬 읽기 전용 연결 probe. 공통 모듈 초기화 전에는 독립 작업 디렉터리에서 probe를 작성한다.

완료 기준: 메시지 스키마와 합성 WebSocket 시험으로 상관 ID·구독 종료·재연결을 확인한다. 실제 데몬에서는 비용 없는 로컬 조회로 연결 조건을 확인한다. 모델 호출이 필요한 의미는 미검증으로 표시한다. 전송 여부를 확인할 수 없으면 재전송 없이 확인 대기로 두는 조건을 계약에 반영한다. 인증·조회 호환을 입증하지 못하면 MIG-013의 직접 연결 승인을 보류한다.

검증 기록: `go -C backend test ./tools/paseoprobe/...`와 `go -C backend run ./tools/paseoprobe -home "$PASEO_HOME"`을 통과했다. 현재 로컬 데몬에서 hello 인증과 존재하지 않는 에이전트의 읽기 전용 조회를 확인했다. 실제 모델 호출은 포함하지 않았다.
