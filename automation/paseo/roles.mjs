import { createHash } from "node:crypto";

// 담당 배정 SSoT: 같은 담당의 단계는 한 Paseo 세션에서 이어 맡는다. 작성·검토는 독립성을 위해 분리.
export const STAGE_ROLES = Object.freeze({
  diagnose: "planner",
  topic: "planner",
  audience: "planner",
  value: "planner",
  outline: "planner",
  route: "planner",
  research: "researcher",
  draft: "writer",
  review: "reviewer",
});
export const roleOf = (/** @type {{type: string, stage?: string}} */ action) =>
  STAGE_ROLES[action.type === "request_route" ? "route" : (action.stage ?? "")] ?? null;

const digest = (/** @type {unknown} */ value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/**
 * 자료 항목별 지문. 재사용 담당에게는 아직 전달하지 않은 지문의 항목만 보낸다.
 * 키: source·idea·direction·feedback·baseline·draftCharacterCount·artifacts.<stage>
 * @param {Record<string, any>} context promptContext 결과
 */
export function contextItems(context) {
  /** @type {Record<string, unknown>} */
  const items = {};
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || key === "artifacts") continue;
    items[key] = value;
  }
  for (const [stage, output] of Object.entries(context.artifacts ?? {}))
    items[`artifacts.${stage}`] = output;
  return Object.fromEntries(
    Object.entries(items).map(([key, value]) => [key, { fingerprint: digest(value), value }]),
  );
}

/**
 * 전달 이력(fingerprints)을 기준으로 새 항목만 남긴 자료와 갱신 이력을 만든다.
 * 같은 키의 값이 바뀌면(수정 회차) 다시 보낸다.
 * @param {Record<string, any>} context
 * @param {Record<string, string>} delivered 키 → 마지막 전달 지문
 */
export function deltaContext(context, delivered = {}) {
  const items = contextItems(context);
  /** @type {Record<string, any>} */
  const delta = {};
  /** @type {Record<string, string>} */
  const next = { ...delivered };
  for (const [key, { fingerprint, value }] of Object.entries(items)) {
    if (delivered[key] === fingerprint) continue;
    next[key] = fingerprint;
    if (key.startsWith("artifacts.")) {
      delta.artifacts ??= {};
      delta.artifacts[key.slice(10)] = value;
    } else delta[key] = value;
  }
  return {
    delta,
    delivered: next,
    omitted: Object.keys(items).filter((key) => delivered[key] === items[key].fingerprint),
  };
}
