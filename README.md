# AIN

독립 글쓰기 자동화. 글감 입력 → 초안 검토 → 수정·내려받기. n8n이 작업 전달·대기, 서비스가 상태·정책·복구 소유.

- 설치: `mise trust` → `mise install` → `mise run setup`
- AI 실행 도구: 인접 공통 `paseo/` 설치·인증 필요 · `automation/paseo/`에서 연결 관심사 검색
- 자격증명: `mise run ai:setup` · 최초 n8n은 `mise run n8n`으로 소유자 계정 생성 · `OPS-001`
- 실행: `mise run editorial` · 글쓰기 http://localhost:3230/write/ · n8n http://localhost:5678 · AI 실행 관찰 http://127.0.0.1:6767/
- 개발: `mise run editorial`로 서비스 시작 → 별도 터미널 `mise run editorial:dev` · Vite 주소에서 같은 로컬 API 사용
- AI 대행: `mise run ain` · 대화형 AI가 사용자 대신 의뢰·수정·삭제 · 스킬 `ain-write` · AGENT-001
- 정적 검사: `mise run check` · TypeScript·Biome·dependency-cruiser·Knip·gitleaks
- 공개 전 검사: `mise run secrets` · 비밀값·개인 이메일·홈 경로·전화번호 · 작업 트리와 Git 이력
- 검증: `mise run test` → `mise run n8n:test:runtime` → `mise run ai:test:flow` → `mise run editorial:e2e`
- 문서 탐색: `docs/` · architecture / decisions / specs / operations · 고정 ID 검색
- 공개 계약: `AIN-API-001` · 구조: C1·C2·C3 · 데이터·복구: OPS-001
- 필수 흐름: 8단계·현재 revision 검증 · 이전 부분 초안은 명시적 보완 · `FLOW-001`
- AI 검토는 사실 보증과 별개 · 별도 웹 조사·실제 발행 없음
- 실제 계약 검증: `mise run ai:test:contract` · 합성 입력·격리 데이터·기본 모델 최대 9회 비용 호출
