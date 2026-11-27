# Go 백엔드 이식 계획

- contracts · 계약 확정, 기준 동작 수집, 병렬 착수
- execution · SQLite 저장, 작업 실행, Paseo 연결과 세션
- editorial · 글·시각자료 전이, 프롬프트, 결과 검증
- clients · HTTP·SSE, 내보내기, React·CLI
- release · 기준 측정, 통합, 데이터 전환, MIT 배포

마일스톤은 `rg --files plan/go-migration | sort`로 찾는다. 착수는 `rg -w MIG-001 plan/go-migration`으로 찾는다. 선행 관계는 각 작업의 ‘선행’에서 확인한다. 문서 규칙은 RULE-CORE·ADR·SPEC·TEST·OPS를 적용한다.
