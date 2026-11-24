// 다른 프로젝트 담당자에게 넘길 요청 문구 SSoT · 화면 복사와 CLI가 같은 문구를 쓴다(ADR-0012)
// 받는 쪽은 보낼 폴더의 묶음 파일만 읽는다 · 제목이 겹쳐도 글 id·회차로 특정

/** @param {{ id: string, title: string, revision: number, path: string }} handoff */
export const handoffRequest = ({ id, title, revision, path }) =>
  [
    `AIN에서 발행 준비가 승인된 글 「${title}」을 블로그에 게시해 주세요.`,
    `- 묶음 파일: ${path}`,
    `- 글 id ${id} · 승인 회차 ${revision}`,
    "- manifest.json에 본문 파일과 그림 배치 정보가 있습니다.",
  ].join("\n");
