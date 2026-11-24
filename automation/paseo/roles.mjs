import { createHash } from "node:crypto";
import { FIGURE_PASSES } from "../contracts/figure.mjs";

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
  // 시각자료 위치 제안·생성 · 본문 담당과 분리 · FIGURE-001
  figure_plan: "illustrator",
  figure_compose: "illustrator",
  figure: "illustrator",
});
/** 담당(프롬프트의 역할 문장) */
export function roleOf(/** @type {{type: string, stage?: string, pass?: string}} */ action) {
  if (action.type === "request_figure" && action.stage === "figure") return "illustrator"; // 모든 층이 그린 담당 · 내용 독립 검토는 사람 확인과 구성 검수가 맡는다 · ADR-0026
  return STAGE_ROLES[action.type === "request_route" ? "route" : (action.stage ?? "")] ?? null;
}
/**
 * 담당 세션 열쇠 · 시각자료 생성은 그림 한 장이 작업 단위라 그림마다 세션을 따로 둔다
 * (다른 그림의 맥락이 한 세션에 쌓이지 않게) · ADR-0017
 */
export function sessionKeyOf(
  /** @type {{type: string, stage?: string, pass?: string, figureId?: string}} */ action,
) {
  const role = roleOf(action);
  return role && action.type === "request_figure" && action.figureId
    ? `${role}:${action.figureId}`
    : role;
}

/**
 * 이 작업 뒤 같은 세션 열쇠로 이어질 작업이 없는가 · 그림 한 장의 세션은 그 그림이 끝나면 바로 내려놓는다
 * (마지막 그리기 층·수정 층 뒤)
 */
export function sessionEndsAfter(
  /** @type {{type: string, stage?: string, pass?: string, figureId?: string}} */ action,
) {
  const at = FIGURE_PASSES.indexOf(/** @type {any} */ (action.pass ?? FIGURE_PASSES[0]));
  const followed = at !== -1 && at < FIGURE_PASSES.length - 1; // 다음 층이 같은 세션을 이어 씀
  return (
    action.type === "request_figure" &&
    action.stage === "figure" &&
    Boolean(action.figureId) &&
    !followed
  );
}

const digest = (/** @type {unknown} */ value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/**
 * 자료 항목별 지문. 재사용 담당에게는 아직 전달하지 않은 지문의 항목만 보낸다.
 * 키: source·idea·direction·feedback·baseline·draftCharacterCount·draftMetrics·requirements·brief·previousSection·artifacts.<stage>
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
