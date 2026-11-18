// AI 응답에서 최상위 JSON 객체 후보를 순서대로 뽑는다 · 문자열 안 중괄호는 무시
// 이어 쓰는 세션은 이전 형식의 JSON을 함께 내기도 해서, 호출자가 형식 검사를 통과한 마지막 후보를 고른다
/** @param {string} text */
export function jsonBlocks(text) {
  const blocks = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"' && depth > 0) inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) blocks.push(text.slice(start, i + 1));
    }
  }
  return blocks;
}

/**
 * 형식 검사를 통과한 마지막 JSON 객체. 없으면 첫 실패 이유와 후보 수를 담아 던진다(원문은 담지 않음).
 * @template T
 * @param {string} text
 * @param {{safeParse: (value: unknown) => {success: boolean, data?: T, error?: unknown}}} schema
 * @returns {T}
 */
export function parseLastValid(text, schema) {
  const blocks = jsonBlocks(text);
  let firstError;
  for (const block of blocks.toReversed()) {
    try {
      const result = schema.safeParse(JSON.parse(block));
      if (result.success) return /** @type {T} */ (result.data);
      firstError ??= result.error;
    } catch (error) {
      firstError ??= error;
    }
  }
  const reason = firstError instanceof Error ? firstError.message : "No JSON object";
  throw new Error(`${reason} (JSON 후보 ${blocks.length}개)`);
}
