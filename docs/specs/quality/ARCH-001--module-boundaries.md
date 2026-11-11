# ARCH-001 · 모듈러 모놀리스·의존 방향

- 모듈: contracts(입출력 계약), editorial(편집 도메인·애플리케이션·저장·HTTP·화면), paseo(AI 실행 어댑터), n8n(전달·대기 어댑터), runtime(조립·기동), cli(에이전트용 HTTP 클라이언트)
- 공개 진입점: editorial/index · editorial/domain/index · paseo/index · n8n/editorialWorkflow 생성기 · 다른 모듈의 내부 파일 직접 참조 금지
- 편집 도메인: 순서·revision·선행 결과·만족·승인 규칙 · 순수 전이 · UI·DB·네트워크·Paseo·n8n 의존 금지
- 편집 애플리케이션: 영속 상태·예산·멱등 요청·중단 확인·복구 · 생성자로 저장·AI 실행·전달 포트를 주입
- 화면: 사용자 명령·조회·표시 · 도메인 실행 코드·Node·저장소·실행 어댑터 import 금지
- n8n: 작업 ID 전달→인증된 advance 호출→서버 continue 값에 따른 대기 · Code 노드·상태 전이·예산·모델·승인 정책 없음
- Paseo: 제공자 발견·명시적 모델 실행·작업 결과/중단 확인 · 편집 애플리케이션·저장소 내부 참조 금지
- runtime: 모듈·포트·프로세스 생명주기 조립 · 편집 정책 구현 금지
- cli: `/write/api` 호출·출력 형식만 · contracts 외 의존 금지 · AGENT-001
- 검사: dependency-cruiser의 역방향·내부 참조·순환·브라우저 Node 규칙, architecture.test의 실제 위반 주입, n8n workflow 검증의 Code 노드·도메인 복제 금지
