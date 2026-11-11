---
name: ain-write
description: 사용자와 대화하며 AIN에 글쓰기를 의뢰·추적·수정·삭제한다. 사용자가 글을 써 달라거나, AIN 작업 목록·초안·수정·삭제를 언급할 때 사용.
---

# AIN 글쓰기 대행

사용자 대신 AIN을 조작한다. 통로는 `mise run ain -- <명령>` (계약 AGENT-001). 화면(/write/)은 사용자가 진행을 보고 싶다고 할 때만 브라우저로 연다.

## 준비

- `mise run ain -- list`가 연결 오류면 사용자에게 `mise run editorial` 실행을 요청한다. 직접 기동해도 되는지 먼저 묻는다.

## 의뢰

1. 대화에서 글감·원하는 결과·독자·글 성격을 정리한다. 모호하면 한 번에 묻고, 정할 근거가 없으면 `auto`로 둔다.
   - mode: explain(설명)·procedure(따라 하기)·argue(주장)·narrate(이야기)·auto
   - level: beginner·intermediate·expert·auto
2. 사용자가 준 원문·확인한 사실은 파일로 저장해 `--source-file`로 넘긴다. 링크만으로는 원문을 읽지 않는다.
3. `new`는 AI 비용이 든다. 정리한 의뢰 내용을 보여 주고 승인 후 실행한다.
4. `wait <id>`는 백그라운드로 실행하고 종료 시 결과를 확인한다. 폴링하지 않는다.

## 결과 보고

- `status`·`label`·`issue`·`findings`를 근거로 실제 상태만 보고한다. AI 검토 통과를 만족·발행 승인으로 표현하지 않는다.
- 본문은 요약하고, 전문은 요청 시 `show <id> --text` 또는 `download`.
- `issue`가 있으면 내용과 가능한 동작(`can`)을 알려 주고 사용자 결정을 받는다.

## 후속 동작

| 사용자 의도 | 명령 | 확인 |
| --- | --- | --- |
| 고쳐 달라 | `feedback <id> <구체적 수정 내용>` | AI 비용 · 수정 내용 확인 후 |
| 멈춰 | `pause <id>` | 즉시 |
| 이어서 | `resume <id>` | AI 비용 |
| 보완 필요 표시 | `complete-requirements <id>` | AI 비용 |
| 이대로 좋다 | `satisfy <id>` | 사용자 명시 발언 필요 |
| 발행 준비 승인 | `authorize-publication <id>` | 사용자 명시 발언 필요 |
| 지워 | `delete <id>` | 제목 보여 주고 확인 · 진행 중이면 먼저 pause |

- 409는 다른 곳에서 바뀐 것: `show`로 최신 상태를 보고 다시 판단한다.
- 실제 발행은 AIN 범위 밖이다.
