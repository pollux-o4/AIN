# OPS-001 · 설치·기동·복구

- 사전 조건: Node·pnpm·n8n은 mise 정본 · 공통 Paseo 설치·인증 완료
- 최초: `mise run ai:setup` → `mise run n8n` → 브라우저 소유자 생성 → 종료
- 계정 전달: `.local/n8n/dev-account.json`에 email·password 비공개 저장 · 파일 권한 600 · 토큰·계정 커밋·출력 금지
- 브라우저 검증 준비: `pnpm exec playwright install chromium` · 잠금 파일의 버전 사용
- 기동: `mise run editorial:start` · 백그라운드 · 서비스가 현재 코드보다 오래됐으면 재시작 · 실행기(launch.sh)도 이 명령 사용 · 포그라운드 `mise run editorial` · n8n 관리 워크플로 변경 전 비공개 백업
- 상태·재시작: `mise run editorial:status`·`editorial:restart` · 소유 판정은 저장소 경로에서 실행한 supervisor·bridge·n8n 프로세스 · 공통 Paseo 데몬 제외
- 성공: 출력된 `/write/` 접속 · 준비된 작업 조회 · 새 요청은 실제 제공자 비용 발생
- 종료: `mise run editorial:stop` · `waiting_ai`·`waiting_route` 작업이 있으면 거부 · `--force`는 사용자 확인 후 · 포그라운드 실행은 Ctrl+C
- 백업·이동: 활성 AI 작업 없음 확인 → 소유 서비스·n8n 종료 → `.local/ai-runtime/`·`.local/n8n/` 전체 보존 · SQLite WAL·암호화 키·자격증명 포함
- 복구: 종료 상태에서 전체 복원 → 권한 확인 → 기동 → 기존 revision·작업 ID 조회 · 불확실한 작업은 기존 실행 확인 후 재연결
- 이관 검증: `.local/migration/moved-files.json`의 파일별 해시 · 이동 시점 원본 보존 확인용 · 이후 정상 변경 파일과 구분
- 과거 실행 증거: private .local 보존 · 실행 환경의 과거 절대 경로는 역사 값이며 현재 런타임 입력으로 사용 금지
- 새 코드 적용: bridge 시작 시각 < `automation/` 코드 최종 수정 시각이면 이전 코드 · `editorial:start`가 진행 중 작업 없을 때 재시작
