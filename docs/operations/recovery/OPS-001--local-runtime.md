# OPS-001 · 설치·기동·복구

- 사전 조건: Node·pnpm·n8n은 mise 정본 · 공통 Paseo 설치·인증 완료
- 최초: `mise run ai:setup` → `mise run n8n` → 브라우저 소유자 생성 → 종료
- 계정 전달: `.local/n8n/dev-account.json`에 email·password 비공개 저장 · 파일 권한 600 · 토큰·계정 커밋·출력 금지
- 브라우저 검증 준비: `pnpm exec playwright install chromium` · 잠금 파일의 버전 사용
- 기동: `mise run editorial` · 기존 서버 재사용 · n8n 관리 워크플로 변경 전 비공개 백업
- 성공: 출력된 `/write/` 접속 · 준비된 작업 조회 · 새 요청은 실제 제공자 비용 발생
- 종료: Ctrl+C · 이 명령이 시작한 자식 서버만 종료 · 재사용한 서버는 별도 소유자 확인
- 백업·이동: 활성 AI 작업 없음 확인 → 소유 서비스·n8n 종료 → `.local/ai-runtime/`·`.local/n8n/` 전체 보존 · SQLite WAL·암호화 키·자격증명 포함
- 복구: 종료 상태에서 전체 복원 → 권한 확인 → 기동 → 기존 revision·작업 ID 조회 · 불확실한 작업은 기존 실행 확인 후 재연결
- 이관 검증: `.local/migration/moved-files.json`의 파일별 해시 · 이동 시점 원본 보존 확인용 · 이후 정상 변경 파일과 구분
- 과거 실행 증거: private .local 보존 · 실행 환경의 과거 절대 경로는 역사 값이며 현재 런타임 입력으로 사용 금지
- 새 계약 적용: `/healthz` protocol 확인 · 이전 프로세스는 자동 재사용하지 않음 · 활성 작업·소유 프로세스 확인 후 재시작
