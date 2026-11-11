/** @type {Record<string, readonly (readonly [string, string])[]>} */
export const outputFields = {
  route: [
    ["target", "수정할 단계"],
    ["reason", "수정 방향"],
  ],
  diagnose: [
    ["purpose", "글의 목적"],
    ["audience", "예상 독자"],
    ["primaryMode", "주 서술 방식"],
    ["readerLevel", "독자 수준"],
    ["sectionModes", "구간별 서술 방식"],
    ["preserveVoice", "유지할 문체"],
    ["strategy", "작성 방향"],
  ],
  topic: [
    ["problem", "다룰 문제"],
    ["scope", "주제의 범위"],
  ],
  audience: [
    ["reader", "대상 독자"],
    ["intent", "독자가 원하는 것"],
  ],
  value: [
    ["outcome", "전달할 가치"],
    ["preserve", "유지할 내용"],
  ],
  research: [
    ["evidence", "근거와 출처"],
    ["uncertainties", "확인이 필요한 내용"],
  ],
  outline: [
    ["sections", "글의 구성"],
    ["rationale", "구성 이유"],
  ],
  draft: [
    ["text", "초안 본문"],
    ["changeSummary", "작성·수정 요약"],
  ],
  review: [
    ["findings", "검토 의견"],
    ["preservationCheck", "원문 보존 확인"],
  ],
};
