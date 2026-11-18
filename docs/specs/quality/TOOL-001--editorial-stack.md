# TOOL-001 · 편집 스택 검증

## TEST-RUN · 검증 실행

- 정본: `mise-tasks/test.toml` · `pnpm test`·`check`·`verify`는 mise 위임
- 캐시: 작업별 sources가 마지막 성공 이후 그대로면 생략 · 강제 `mise run --force <작업>`
- 원칙: 바꾼 범위부터 → 커밋 전 `verify` 한 번 · 무거운 통합·e2e는 `nice` 낮은 우선순위

| 묶음 | 명령 | 범위 · 시간(실측) |
| --- | --- | --- |
| 정적 | `check` = `check:types`·`check:lint`·`check:arch` + secrets | 약 2초 |
| 단위 | `test` = `test:editorial`·`test:paseo`·`test:n8n`·`test:cli`·`test:runtime`·`test:arch` | 병렬 약 4초 · 제품 코드 변경은 전체, 테스트만 바꾸면 해당 모듈 |
| 통합 | `test:n8n:runtime` → `test:flow` | 격리 n8n · fixture 제공자 |
| 화면 | `test:e2e` (PC·모바일) · `test:e2e:quick` (PC만, 캐시 없음) | 약 1분(병렬 4) · n8n 대신 같은 계약의 프로세스 내 전달자 · 글감 저장·초안·수정·중단·실패·TXT·접근성 |
| 전체 | `verify` | 위 전부 · 각 작업 캐시 |

- `build`: `/write/` 자산 · 화면 코드가 바뀔 때만 · 운영 기동 `editorial:start`는 타입 검사 포함 빌드
- UI 개발: 서비스 `mise run editorial` 유지, `mise run editorial:dev` · Vite가 `/write/session`·`/write/api`를 로컬 서비스에 전달
- 보안: 빌드 JS·CSS만 공개, 기존 Markdown HTML 제한·CSP 유지 · 저장소·인증 데이터 이동 없음
- 기존 서비스 프로세스가 실행 중이면 작업 상태 확인 후 재시작 · 새 빌드는 실행 중인 서버 코드를 교체하지 않음
- FLOW-001: 단계 건너뛰기·누락/이전 revision 거부, 기존 부분 초안의 명시적 보완·원고 보존, 확정·발행 준비 승인 분리 검증
- 전체 검증 `mise run verify`: 작업별 시간 예산 대조·전체 5분 이내 · TIME-001
- 실제 모델 검증은 기본 `verify`에 포함하지 않음 · OPS-003의 명시적 `ai:test:contract`(연결 1회·합성 글 1편)와 `ai:eval`(글감별 반복·통과율) 수행
