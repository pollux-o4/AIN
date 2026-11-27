# MIG-054 · Go 런타임 패키징

빌드 호스트에 Go, Node와 잠금 파일의 프런트엔드 의존성을 준비한다. 패키지가 들어갈 상위 디렉터리를 만든 뒤 실행한다. `--staging`은 내부 합성 검증본을 만든다.

```sh
node backend/tools/release/package.mjs --output .local/release/ain --staging
node backend/tools/release/smoke.mjs --package .local/release/ain --browser
```

Linux 호스트용 정적 Go 서버와 React 자산을 묶는다. 시험은 임시 경로로 패키지를 옮기고 비어 있는 서버 PATH, 합성 인증, 새 DB를 사용한다. 상태·세션·목록 API와 자산 해시를 확인한다. `--browser`를 사용하면 빌드 호스트의 Playwright Chromium으로 실제 화면을 확인한다. 별도 Node CLI에서 같은 Go API의 목록을 조회한다.

linux/amd64 검증에서 패키지를 임시 디렉터리로 옮긴 뒤 서버 PATH를 비워 기동했다. Chromium 화면과 별도 Node CLI의 목록 조회가 통과했다. 고지 목록에는 JS 4개, 추가 편집 자산 3개, Go 모듈 11개, 표준 라이브러리 벤더 4개와 Go 도구 체인이 기록됐다.

## 재배포 고지

패키지의 `share/licenses/index.json`은 Go 바이너리의 의존 모듈, 사용한 Go 표준 라이브러리의 벤더 구성, Vite가 찾은 번들 내 JS 모듈, 추가 자산을 해당 배포본의 고지와 연결한다.

| 배포 구성 | 고지 원본 |
|---|---|
| Go, 모듈, 표준 라이브러리 벤더 | 빌드에 사용한 배포본의 LICENSE·PATENTS·추가 고지. SQLite의 `SQLITE-LICENSE`를 포함한다. |
| React, React DOM, scheduler, Zod | Vite의 번들 목록과 실제 MIT 라이선스 본문 |
| Tailwind CSS, Vite의 모듈 로딩 보조 코드 | 설치된 버전의 MIT 라이선스 |
| Galmuri 웹폰트 | 배포본의 SIL Open Font License 1.1와 저작권 고지 |

AIN 외부 배포에는 승인된 저작권자가 기재된 루트 MIT `LICENSE`가 필요하다. 검증 시점의 저장소에는 AIN 라이선스 파일 및 패키지 라이선스 필드가 없었다. Git 작성자 표시는 권리 귀속 증빙으로 삼지 않았다.

MIG-002에서 참고한 Paseo 0.17.5 공식 패키지는 Apache-2.0이며 패키지의 원본 고지에는 Mohamed Boudra가 기재되어 있다. 이 배포본에는 데몬과 JS SDK가 들어가지 않는다. 공개 전에 이식한 프로토콜 코드의 출처와 상류 고지 적용 범위를 확인한다.
