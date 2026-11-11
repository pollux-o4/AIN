# ADR-0002 · 타입·계약·화면 도구

- 맥락: 글쓰기 화면 확장과 HTTP·AI 결과 경계의 검증·의존성 관리 필요
- 선택: React·Vite·Tailwind CSS, TypeScript strict, Zod, Biome, dependency-cruiser·Knip, Playwright·axe
- 유지: Node.js·pnpm·mise, SQLite, n8n 전달·대기, 공통 Paseo 실행, 기존 API·데이터 · 흐름 정책은 ADR-0003 적용
- 대안: DOM 직접 조작 유지 / 서버·DB까지 교체 · 화면 상태 관리와 계약 개선에 범위를 한정
- 경계: UI는 공개 HTTP 계약 소비 · 구조 검증은 Zod · 단계·revision·승인은 기존 상태 머신
- 타입: 신규 UI strict · 기존 서버 MJS는 실행 유지, 전면 타입 전환은 별도 범위
- 검증: TOOL-001 · 타입·정적 검사·의존 경계·미사용 검사 → 단위 → 격리 n8n → PC·모바일 E2E
