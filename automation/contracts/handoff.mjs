// 다른 프로젝트 담당자에게 넘길 가져오기 요청 SSoT · 화면 복사와 CLI가 같은 문구를 쓴다(ADR-0012)
// 제목은 겹칠 수 있으므로 글 id로 특정한다 · 내보내기에는 사람이 확인한 그림만 들어간다

/** @param {string} id */
const handoffCommand = (id) =>
  `mise run ain -- export ${id} --format zip --out ain-${id.slice(0, 8)}.zip`;

/** @param {{ id: string, title: string }} run */
export const handoffRequest = ({ id, title }) =>
  [
    `AIN에서 발행 준비가 승인된 글 「${title}」을 가져와 블로그에 게시해 주세요.`,
    `- 글 id: ${id}`,
    `- 가져오기(AIN 저장소에서 실행): ${handoffCommand(id)}`,
    "- 묶음의 manifest.json에 그림 배치 정보가 있습니다.",
  ].join("\n");
