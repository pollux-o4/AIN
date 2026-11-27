# ADR-0002 · 타입·계약·화면 도구

- 맥락: 글쓰기 화면을 확장하면서 HTTP와 AI 결과 경계를 검증하고 의존성을 관리해야 한다.
- 선택: 화면에는 React·Vite·Tailwind CSS와 TypeScript strict를 쓰고, 검증·검사 도구로 Zod, Biome, dependency-cruiser·Knip, Playwright·axe를 도입한다.
- 유지: Node.js·pnpm·mise, SQLite, n8n 전달·대기, 공통 Paseo 실행, 기존 API와 데이터는 그대로 둔다. 흐름 정책은 ADR-0003을 따른다.
- 대안: DOM 직접 조작을 유지하는 방안과 서버·DB까지 교체하는 방안을 검토하였다. 작업 범위는 화면 상태 관리와 계약 개선으로 한정한다.
- 경계: UI는 공개 HTTP 계약만 사용하고, 구조 검증은 Zod로 처리한다. 단계, 회차, 승인은 기존 상태 머신이 맡는다.
- 타입: 신규 UI에는 TypeScript strict를 적용하고, 기존 서버 MJS는 그대로 실행한다. 전면 타입 전환은 별도 범위로 둔다.
- 검증: TOOL-001에 따라 타입·정적·의존 경계·미사용 검사, 단위, 격리 n8n, PC·모바일 E2E 순서로 검증한다.
