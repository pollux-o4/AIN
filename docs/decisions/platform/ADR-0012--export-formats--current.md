# ADR-0012 · 내보내기는 소비처와 무관한 표준 형식 묶음

- 맥락: 시각자료(움직이는 SVG 포함)가 붙은 글을 블로그·문서·메일 등 어디든 넘겨야 함 · AIN은 소비 제품의 코드·경로·인증에 의존하지 않음(AGENTS 경계) · 기존 인계는 TXT 본문과 SVG 파일 개별 제공뿐이라 배치 위치가 함께 가지 않음
- 대안: 소비처별 출력(특정 블로그 HTML·업로드) — 경계 위반·소비처마다 변경 / 단일 HTML만 — 그림 파일을 따로 올리는 곳에서 재가공 필요 / 표준 형식 여러 개 + 배치 매니페스트
- 선택(2026-11-13 사용자 결정): 무엇을 어떻게 만들어 내보낼지만 정하고 어디서 쓸지는 받는 쪽이 고른다
  - 형식: `txt`(본문 그대로 · 기존 인계 계약 불변) · `html`(완결 문서 한 파일 · 그림은 data URI `<img>`) · `zip`(아래 묶음)
  - 묶음: `manifest.json`(`ain-article-bundle` v1 · 글 id·제목·회차·그림별 anchor·alt·caption·animated·파일) · `article.md`(본문 글자 그대로 + 앵커 문단 뒤 상대 경로 이미지) · `article.html`(완결 문서) · `article-body.html`(문서 조각 · 파일 참조) · `figures/<id>.svg`(움직임) · `figures/<id>.static.svg`(정지판)
  - 그림 삽입: 항상 `<img>` · 문서 CSS·id 충돌 없이 격리되고 스크립트가 돌지 않으며 SVG 자체 움직임은 재생 · 인라인 `<svg>`·스크립트는 넣지 않음(받는 쪽이 원하면 묶음의 SVG로 직접 처리)
  - 움직임: `motion=animated`(기본) | `static`(SMIL 요소 제거 + CSS 애니메이션 정지 = 첫 프레임) · 애니메이션을 지우는 곳(RSS·메일·인쇄)용
  - 범위: 지정 회차 본문 + 현재 회차에서 사람이 확인한 시각자료만(`figure.phase=confirmed`) · 준비됨(확인 전)·이전 회차 그림은 넣지 않음
  - 통로: `GET /write/api/runs/<id>/export?format&motion&revision` · CLI `ain export <id> --out <파일> [--format] [--motion]` · 화면 '내보내기' 메뉴 · 응답은 내려받기 전용(`Content-Disposition: attachment` + CSP sandbox)
- 제약: ZIP은 무압축(STORE)·ZIP64 미지원(코드 `shortcut`) · PDF·PNG 래스터 미제공(필요해지면 렌더러 도입 검토)
- 책임: 형식 생성 `automation/editorial/export/` · 본문 렌더러는 화면과 공용(`article-html.mjs` renderArticle)
- 관련: ADR-0011 · FIGURE-001 · AGENT-001
