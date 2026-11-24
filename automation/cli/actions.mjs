import { randomUUID } from "node:crypto";
import { ACTIONS } from "../contracts/actions.mjs";
import { CliError } from "./client.mjs";

// 동작 명령은 카탈로그에서 만든다 · 화면과 같은 동작을 같은 이름으로 · 권한은 서버가 판정(사람만이면 403) · AGENT-001
const kebab = (/** @type {string} */ type) => type.replaceAll("_", "-");

/** @param {string | undefined} input */
function payload(input) {
  if (input === undefined) return {};
  try {
    const value = JSON.parse(input);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {}
  throw new CliError('--input에는 객체를 적습니다. 예: {"figures":["f1"],"look":"manual"}');
}

/** @param {(run: any) => unknown} summary */
export function actionCommands(summary) {
  return Object.fromEntries(
    Object.entries(ACTIONS).map(([type, spec]) => [
      kebab(type),
      async (client, [id, ...words], options) => {
        if (!id) throw new CliError("작업 ID가 필요합니다.");
        const text = words.join(" ").trim();
        if (spec.text && !text) throw new CliError(`${spec.text}이 필요합니다.`);
        const run = await client.get(id);
        const result = await client.action(id, {
          ...payload(options.input),
          ...(text ? { feedback: text } : {}),
          operationId: randomUUID(),
          expectedVersion: run.version,
          type,
        });
        return summary(result);
      },
    ]),
  );
}

export const actionUsage = () =>
  Object.entries(ACTIONS)
    .map(([type, spec]) => {
      const args = `${kebab(type)} <id>${spec.text ? ` <${spec.text}>` : ""}`;
      const mark = [spec.cost ? "AI 비용" : "", spec.actor === "human" ? "사람만·화면" : ""]
        .filter(Boolean)
        .join(" · ");
      // 한글은 두 칸 폭 · 도움말 열 맞춤
      const width = [...args].reduce((n, ch) => n + (ch > "\u1100" ? 2 : 1), 0);
      return `  ${args}${" ".repeat(Math.max(1, 39 - width))}${spec.summary}${mark ? ` (${mark})` : ""}`;
    })
    .join("\n");
