# MIG-003 · 기존 동작 기준 fixture

선행 MIG-001 계약. 전용 경로 `tests/migration/reference/`. 현행 Node 코드를 기준으로 하고 Go 포트의 fixture 형식은 MIG-001을 사용한다.

1. 동일 입력·고정 시각·고정 ID에서 상태 전이, operation 충돌, 이력, AI 예산, 프롬프트·결과 스냅샷을 추출한다.
2. HTTP·SSE의 성공·실패, CLI 동작, TXT·HTML·ZIP·시각자료의 표본을 고정한다. 시간이나 순서는 계약상 의미가 없는 경우에만 정규화한다.
3. 합성 기존 SQLite DB·job JSON·workspace·worker 등록부를 만든다. 누락 필드, 이전 회차, 대용량 행, 중단·연결 유실·그림 하위 작업을 포함한다.

완료 기준: 기존 fixture·snapshot을 재사용해 같은 기준 커밋으로 다시 생성한 결과가 일치한다. 원문·토큰·운영 데이터와 실제 모델 호출은 수집 범위 밖이다. Go에서 허용할 차이는 기대 파일을 바꾸기 전에 명세 변경 근거와 연결한다.

검증: AIN-API-001, FLOW-001, EDIT-001, LIVE-001, HISTORY-001, FIGURE-001, JUDGE-001, AGENT-001.
