# ADR-0027 · 그림 스타일은 글 하나에 하나를 구성이 고른다

- 맥락: 생성 수단이 anatomy 아이소메트릭 하나로 고정되어, 절차·관계·개념 정리처럼 평면 도식이 더 빨리 읽히는 자리도 실물 비유 입체로 그렸다.
- 선택:
  - 스타일 목록 `FIGURE_LOOKS`(계약)와 그리기 규칙 `LOOK_RULES`(`paseo/prompts/looks.mjs`)를 같은 id로 둔다: anatomy·sketchnote·tablet·stick·manual.
  - 구성(`figure_compose`)이 글 전체에 하나를 `style.look`에 적는다. 그림 사이 일관성(ADR-0022)을 위해 자리마다 바꾸지 않는다. 모르는 값은 버리고, 없으면 anatomy로 그린다.
  - 생성 층은 고른 스타일의 그리기·준비·마감 규칙만 받는다. 키트 도구는 anatomy에만 싣는다.
  - anatomy 밖 규칙은 Lemo-Opuscar STYLE.md(CC BY-NC 4.0)에서 영상 문법을 걷어내고 SVG 한 장에 맞게 줄여 옮겼다. 출처는 규칙 파일 머리에 적는다.
- 결과:
  - 사람은 구성 검수에서 스타일을 확인하고, 바꾸려면 의견으로 다시 구성한다.
  - 손글씨 글자는 미룬다(글꼴을 SVG 안에 넣는 도구 필요, 규칙 파일의 shortcut).
  - 블로그가 수익을 내면 CC BY-NC 범위를 다시 확인한다.
- 관련: ADR-0011, ADR-0022, ADR-0026, FIGURE-001
