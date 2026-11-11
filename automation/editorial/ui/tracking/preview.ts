import { outputFields } from "../../../contracts/output-fields.mjs";

// Only public output fields are previewed; partial JSON is never treated as a saved artifact.
function strings(source: string) {
  const matches = source.matchAll(/"((?:[^"\\]|\\.)*)(?:"|$)/g);
  return Array.from(matches, (match) => {
    const value = match[1].replace(/\\(?:u[\da-fA-F]{0,3})?$/, "");
    try {
      return JSON.parse(`"${value}"`) as string;
    } catch {
      return "";
    }
  }).filter(Boolean);
}
export function previewFields(text: string, stage: string) {
  const fields = outputFields[stage] ?? [];
  return fields.flatMap(([field, label]) => {
    const match = new RegExp(`"${field}"\\s*:\\s*`).exec(text);
    if (!match) return [];
    const value = text.slice(match.index + match[0].length);
    if (value.startsWith('"')) {
      const first = /^"((?:[^"\\]|\\.)*)(?:"|$)/.exec(value);
      const content = first ? strings(first[0]).join("") : "";
      return content ? [{ label, text: content }] : [];
    }
    if (field === "evidence" && value.startsWith("[")) {
      const claims = [...value.matchAll(/"claim"\s*:\s*("(?:[^"\\]|\\.)*(?:"|$))/g)].flatMap(
        (item) => strings(item[1]),
      );
      return claims.length ? [{ label, text: claims.join("\n") }] : [];
    }
    if (value.startsWith("[")) {
      // Stop at the array end without mistaking brackets inside strings for delimiters.
      const array = /^\[((?:"(?:[^"\\]|\\.)*(?:"|$)|[^\]"[])*)(?:\]|$)/.exec(value);
      const content = array ? strings(array[1]).join("\n") : "";
      return content ? [{ label, text: content }] : [];
    }
    return [];
  });
}
