# C3 · 편집 모듈·어댑터

## 계약·규칙

- `contract`는 편집 상태, 실행 의도, 저장, Paseo 세션·턴과 활동 형식을 정의한다.
- `writing`과 `figuredomain`은 회차와 단계 전이, 선행 결과, 만족·승인, 그림 상태를 판정한다.

## 서비스·저장·화면

- `editorial`은 사용자의 명령과 조회를 처리한다. `store`는 SQLite 상태와 영속 의도, 세션 등록부와 이관된 이력을 보존한다.
- `httpapi`는 동일 출처 세션, 에이전트 인증, React 자산, 편집 HTTP·SSE를 제공한다. React와 CLI는 HTTP 계약을 사용한다.
- `artifacts`는 회차별 Markdown·TXT, 내보내기, 그림, 승인된 인계를 처리한다.

## 실행·외부 연결

- `runner`는 영속 작업의 동시 실행을 제한하고 완료 확인, 중단, 재기동 복구를 처리한다.
- `writingai`와 `figureai`는 단계별 프롬프트와 결과 파싱을 맡는다. `sessions`는 세션을 대조하고 `paseowire`는 데몬과 직접 통신한다.
- `runtime`은 이 모듈을 조립하고 현재 세션·턴의 공개 활동을 SSE 어댑터에 전달한다(LIVE-001).
