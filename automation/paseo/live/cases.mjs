// 실제 모델 검증에 쓰는 합성 글감 · 실존 인물·조사·통계 없이 서술 방식별 한 건씩
// 새 사례는 여기에 항목 하나를 더한다 · 평가 기준은 grade.mjs가 소유
const SYNTHETIC = "실제 인물·연구·통계가 아니다.";

/** @typedef {{ id: string, idea: string, source: string, direction?: { mode: string, readerLevel: string } }} LiveCase */

/** @type {LiveCase[]} */
export const LIVE_CASES = [
  {
    id: "narrate",
    idea: "합성 검증용 한국어 수필 600~900자. 처음 요리를 해 보는 사람이 장보기 목록을 만들어 실수를 줄인 가상의 하루를 1인칭으로 써 주세요. 독자는 요리 초보자. 가상의 사례라는 점과 사람마다 준비가 다르다는 한계를 유지하고 실제 조사·의학·영양 조언·통계·출처는 만들지 마세요.",
    source: `합성 사례: 나는 주말에 처음 국을 만들려고 장보기 목록을 작성했다. 목록을 보고 재료를 준비하니 빠뜨린 것을 다시 사러 갈 일이 줄었다. ${SYNTHETIC}`,
  },
  {
    id: "explain",
    idea: "합성 검증용 설명 글 1200~1600자. 비밀번호 관리자가 무엇이고 왜 쓰는지 처음 듣는 사람에게 설명해 주세요. 독자는 컴퓨터를 메일과 쇼핑에만 쓰는 사람. 특정 제품 이름·가격·통계·출처는 만들지 마세요.",
    source: `합성 설명: 비밀번호 관리자는 사이트마다 다른 긴 비밀번호를 대신 기억해 주는 프로그램이다. 사용자는 관리자를 여는 주 비밀번호 하나만 기억한다. 같은 비밀번호를 여러 사이트에 쓰면 한 곳에서 새어 나갔을 때 다른 곳도 위험해진다. 주 비밀번호를 잊으면 저장한 비밀번호를 되찾기 어렵다는 한계가 있다. ${SYNTHETIC}`,
    direction: { mode: "explain", readerLevel: "beginner" },
  },
  {
    id: "procedure",
    idea: "합성 검증용 따라 하기 글 800~1200자. 새 노트북을 처음 켠 사람이 사진 폴더를 외장 디스크에 백업하는 순서를 알려 주세요. 독자는 파일 복사를 해 본 적 없는 사람. 특정 제품 이름·가격·통계·출처는 만들지 마세요.",
    source: `합성 절차: 외장 디스크를 꽂는다. 파일 탐색기에서 사진 폴더를 찾는다. 폴더를 외장 디스크로 끌어 놓아 복사한다. 복사가 끝나면 외장 디스크에서 사진 몇 장을 열어 확인한다. 안전하게 제거를 누른 뒤 뽑는다. 복사 중에 뽑으면 파일이 깨질 수 있다. ${SYNTHETIC}`,
    direction: { mode: "procedure", readerLevel: "beginner" },
  },
  {
    id: "argue",
    idea: "합성 검증용 주장 글 900~1300자. 회의 전에 안건을 글로 먼저 공유해야 한다고 팀 동료를 설득해 주세요. 독자는 회의가 길다고 느끼는 직장인. 가상의 사례라는 점을 밝히고 실제 회사·조사·통계·출처는 만들지 마세요.",
    source: `합성 사례: 가상의 팀이 회의 하루 전에 안건과 결정할 것을 한 쪽으로 적어 공유했다. 회의에서 배경 설명 시간이 줄고 결정할 것부터 이야기했다. 글을 미리 읽지 않고 오는 사람이 있으면 효과가 줄어든다는 반론이 있다. ${SYNTHETIC}`,
    direction: { mode: "argue", readerLevel: "intermediate" },
  },
];

/** @param {string} id */
export function liveCase(id) {
  const found = LIVE_CASES.find((entry) => entry.id === id);
  if (!found)
    throw new Error(`Unknown live case: ${id} (${LIVE_CASES.map((c) => c.id).join("|")})`);
  return found;
}
