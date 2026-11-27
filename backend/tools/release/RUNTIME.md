# AIN Go 런타임

`bin/ain`과 `share/ain/editorial-web/`을 같은 패키지에서 사용한다. 임의 위치로 옮긴 뒤 다음과 같이 기동한다.

```sh
"$AIN_RELEASE/bin/ain" \
  -listen 127.0.0.1:3230 \
  -assets "$AIN_RELEASE/share/ain/editorial-web" \
  -data "$AIN_DATA" -outbox "$AIN_OUTBOX" \
  -paseo-home "$PASEO_HOME" -provider "$AIN_PROVIDER" -model "$AIN_MODEL"
```

- 서버 환경에 서로 다른 `AIN_SESSION_KEY`와 `AIN_AGENT_TOKEN`을 설정한다. 둘 다 최소 32자이며 배포본 밖에 비공개로 보관한다. `AIN_DATA`는 새 전용 디렉터리 또는 운영 이관에서 승인한 Go 후보 복제본이다. `AIN_OUTBOX`는 인계 기능을 쓸 때 절대 경로로 지정한다.
- 서버와 편집 화면은 Node·n8n 설치 없이 실행한다. AI 작업은 별도 로컬 Paseo 데몬과 제공자 계정 설정을 사용한다. 인증 파일은 배포본에 포함하지 않는다.
- 브라우저는 `http://127.0.0.1:3230/write/`를 연다. 상태 경로는 `GET /healthz`다. 기존 `mise run ain -- …` CLI는 소스 저장소와 Node를 사용한다. 서버 토큰과 같은 값을 담은 비공개 `agent-token`의 상위 경로를 `AIN_RUNTIME_DIR`에 지정한다. 기본 주소를 바꾼 경우 `AIN_URL`을 지정한다.
- 내장 의존성 고지는 `share/licenses/index.json`에서 찾는다. 파일 크기·SHA-256과 빌드 대상은 `manifest.json`에 기록한다.
- 선택한 Paseo 모델의 사고 단계는 `-thinking`으로 지정한다. 검토와 재작업에 별도 단계를 사용하는 경우 `-review-thinking`을 지정한다. 값은 제공자가 보고한 사고 단계 ID를 사용한다.
