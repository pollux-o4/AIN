# TOOL-001 · 편집 스택 검증

## TEST-RUN · 검증 실행

- 정본: `mise-tasks/test.toml`을 정본으로 삼고, `pnpm test`, `check`, `verify`는 mise에 위임한다.
- 캐시: 작업별 sources가 마지막 성공 이후 그대로이면 실행을 생략한다. 강제로 다시 실행하려면 `mise run --force <작업>`을 쓴다.
- 원칙: 변경한 범위부터 검증한 뒤 커밋 전 `verify`를 한 번 실행한다. 무거운 통합·e2e 작업은 `nice`를 적용하여 낮은 우선순위로 실행한다.

| 묶음 | 명령 | 범위 · 시간(실측) |
| --- | --- | --- |
| 정적 | `check` = `check:types`·`check:lint`·`check:arch` + secrets | 약 2초 걸린다. |
| 단위 | `test` = `test:editorial`·`test:paseo`·`test:n8n`·`test:cli`·`test:runtime`·`test:arch` | 병렬로 실행하면 약 4초 걸린다. 제품 코드를 바꾸면 전체를, 테스트만 고치면 해당 모듈만 실행한다. |
| 통합 | `test:n8n:runtime` → `test:flow` | 격리 n8n과 fixture 제공자 환경에서 실행한다. |
| 화면 | `test:e2e`(PC·모바일) · `test:e2e:quick`(PC만, 캐시 없음) | 병렬 4 기준으로 약 1분 걸린다. n8n 대신 같은 계약의 프로세스 내 전달자를 사용하며, 글감 저장, 초안, 수정, 중단, 실패, TXT, 접근성을 검증한다. |
| 전체 | `verify` | 위 항목 전부를 포함하며, 각 작업은 캐시를 적용한다. |

- `build`: `/write/` 자산을 빌드하며, 화면 코드가 바뀔 때만 실행한다. 운영 기동 명령인 `editorial:start`는 타입 검사를 포함해 빌드한다.
- UI 개발: `mise run editorial`로 서비스를 유지한 상태에서 `mise run editorial:dev`를 실행한다. Vite가 `/write/session`과 `/write/api`를 로컬 서비스로 전달한다.
- 보안: 빌드된 JS·CSS만 공개하고 기존 Markdown HTML 제한과 CSP를 유지한다. 저장소와 인증 데이터는 이동하지 않는다.
- 기존 서비스 프로세스가 실행 중이면 작업 상태를 확인한 뒤 재시작한다. 새 빌드는 실행 중인 서버 코드를 교체하지 않기 때문이다.
- FLOW-001: 단계 건너뛰기 및 누락이나 이전 회차 거부, 기존 부분 초안의 명시적 보완과 원고 보존, 확정과 발행 준비 승인의 분리를 검증한다.
- 전체 검증 `mise run verify`: 작업별 시간 예산을 대조하며 전체 실행을 5분 이내로 유지한다(TIME-001).
- 실제 모델 검증: 기본 `verify`에 포함하지 않는다. OPS-003의 명시적 `ai:test:contract`(연결 1회·합성 글 1편)와 `ai:eval`(글감별 반복·통과율)을 실행한다.
