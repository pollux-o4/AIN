# TOOL-001 · 편집 스택 검증

- `pnpm check`: UI·설정·브라우저 테스트 타입 검사, Biome, 의존 경계, 미사용 파일·의존성·export 검사
- `pnpm build`: 타입 검사 후 같은 출처 `/write/` 자산 생성 · `.local/editorial-web/`는 재생성 가능
- `mise run test`: 빌드·서버 단위 계약 · 기존 입력·revision·멱등 요청·보존·복구 유지
- `mise run n8n:test:runtime` → `mise run ai:test:flow`: 임시 데이터·fixture 제공자 통합
- `mise run editorial:e2e`: PC·모바일 글감 임시 저장·초안·수정·중단·실패·TXT·접근성 검증
- `pnpm verify`: 위 검증 순차 실행 · 실제 AI 호출·사실 정확성 평가는 별도
- UI 개발: 서비스 `mise run editorial` 유지, `mise run editorial:dev` · Vite가 `/write/session`·`/write/api`를 로컬 서비스에 전달
- 보안: 빌드 JS·CSS만 공개, 기존 Markdown HTML 제한·CSP 유지 · 저장소·인증 데이터 이동 없음
- 기존 서비스 프로세스가 실행 중이면 작업 상태 확인 후 재시작 · 새 빌드는 실행 중인 서버 코드를 교체하지 않음
- FLOW-001: 단계 건너뛰기·누락/이전 revision 거부, 기존 부분 초안의 명시적 보완·원고 보존, 확정·발행 준비 승인 분리 검증
- 실제 모델 검증은 기본 `verify`에 포함하지 않음 · OPS-003의 명시적 `ai:test:contract`로 연결 1회와 합성 글 8회 수행
