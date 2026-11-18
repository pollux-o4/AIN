# n8n 전달 어댑터

- 책임: 작업 ID 전달, 인증된 advance 호출, 서버 continue 대기를 맡는다. 도메인·예산·모델·승인 정책은 두지 않으며, 편집 단계, 수정 해석, 시각자료 처리 모두 같은 반복 흐름으로 전달한다.
- 원본: build-editorial-workflow의 editorialWorkflow를 원본으로 사용하며, 기본 workflow ID를 유지한다.
- 생성과 기준: 워크플로는 mise run editorial:build로 생성한다. 정책 경계는 ARCH-001, 실행 기준은 FLOW-001과 EDIT-001을 따른다.
- 검증: workflow 단위 검증과 n8n-runtime 검증을 실행한다. testing/runtime은 별도 데이터와 포트를 사용하는 검증 드라이버이다.
