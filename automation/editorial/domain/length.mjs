// 분량 측정 원천: 독자에게 보이는 글자(공백 포함) · 마크다운 링크 주소는 화면에 안 보여 제외 · ADR-0009
export const readerLength = (text) => Array.from(text.replace(/\]\([^)]*\)/g, "]")).length;
