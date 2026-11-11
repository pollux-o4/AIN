# AIN 작업 기준

- 제품: 독립 글쓰기 자동화 · 입력·초안·수정·실행 추적 · 실제 발행 별도
- 공통 원칙: `~/.codex/init-rules/`의 RULE-CORE·ADR·SPEC·TEST·OPS 적용
- 탐색: `docs/`에서 관심사·고정 ID 검색 · 현재 결정 `rg --files docs/decisions | rg -- '--current\.md$'`
- 경계: 소비 제품의 코드·경로·DB·인증 의존 금지 · 외부 입력·TXT 인계 계약만 제공
- 책임: `automation/editorial/` 사용자 작업·저장·추적 / `automation/n8n/` 전이·전달 / `automation/paseo/` AI 작업·결과 계약
- 사용자 대신 글쓰기 의뢰·수정·삭제: 스킬 `ain-write` · `mise run ain -- <명령>` · 화면 조작은 관찰·E2E용 · AGENT-001
- 실행: `mise.toml` · 의존성: `package.json`·잠금 파일 · 비공개 데이터 `.local/`
- 비밀값·원문 로그·커밋 금지 · 데이터 이동 전 실행 중 작업 확인·정지·무결성 검증
- 검증: 단위 → 격리 n8n → PC·모바일 E2E · 실제 AI 비용 호출과 fixture 구분
- 상태: 실제 확인된 실행·완료·중단만 표시 · 결과 준비와 만족·발행 승인 구분
- 미룬 구체적 제약: 관련 코드에 `shortcut: 제약·이유, 재검토 조건` · 현재 요청 완료에 필요한 처리는 연기 금지
- 위임: 사용자 지정 도구·모델 우선 · 공유 파일 동시 수정·커밋 금지 · 통합 검증은 본체 책임
