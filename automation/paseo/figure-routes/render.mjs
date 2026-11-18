import { createHash } from "node:crypto";
import { figureResultSchema } from "../../contracts/figure-result.mjs";
import { checkFiles } from "./checks.mjs";

// shortcut: 실행기는 계약·테스트까지, 현행 생성(jobs·편집 도메인·화면)은 아직 svg 단일 필드를 씀, f4 비교 시험 뒤 배선
const sha256 = (/** @type {unknown} */ value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

// 능력과 산출이 맞는지 · 어댑터 이름이 아니라 선언한 능력으로만 판단한다(FIGURE-002 L2)
/**
 * @param {import("./types.mjs").RouteAdapter} adapter
 * @param {import("./types.mjs").RouteInput} input
 * @param {import("./types.mjs").RouteOutput} out
 */
function capabilityIssue({ capabilities }, input, out) {
  // 요청한 글자가 결과에 글자 그대로 있는지만 대조한다(JUDGE-001)
  const made = new Set(out.labels.map((label) => label.text));
  if (input.labels.some((label) => !made.has(label.text))) return "Requested label missing";
  if (out.motion && !capabilities.motion) return "Adapter declared no motion";
  if (!capabilities.textInImage && out.labels.some((label) => !label.anchor))
    return "Labels need an anchor when text is not drawn in the image";
  if (out.checks > capabilities.maxChecks) return "Render checks exceeded maxChecks";
  return null;
}

/**
 * 그림 하나 생성 · 선택 → 재사용 확인 → 어댑터 실행 → 능력·파일 검사 → 결과 저장
 * @param {{
 *   registry: import("./registry.mjs").RouteRegistry,
 *   store: { get(key: string): unknown, set(key: string, value: unknown): unknown },
 *   now: () => number,
 * }} deps 저장소·시계는 주입한다(실제 대기 없이 검증 · TIME-001)
 * @param {{ id: string, kind: string | null, route?: string | null }} candidate
 * @param {import("./types.mjs").RouteInput} input
 * @param {import("./types.mjs").RouteContext} ctx
 */
export async function renderFigure({ registry, store, now }, candidate, input, ctx) {
  const adapter = registry.select(candidate);
  const inputHash = sha256(input);
  const key = sha256([inputHash, adapter.id, adapter.version]);
  const kept = await store.get(key);
  if (kept) return figureResultSchema.parse(kept);
  ctx.signal.throwIfAborted();
  const started = now();
  const out = await adapter.render(input, ctx);
  ctx.signal.throwIfAborted();
  const issue = capabilityIssue(adapter, input, out);
  if (issue) throw new Error(issue);
  const result = figureResultSchema.parse({
    id: candidate.id,
    route: adapter.route,
    files: await checkFiles(ctx.dir, out.files),
    alt: out.alt,
    caption: out.caption,
    motion: out.motion,
    labels: out.labels,
    provenance: {
      route: adapter.route,
      adapter: adapter.id,
      model: out.model,
      ms: Math.max(0, Math.round(now() - started)),
      tokens: out.tokens,
      inputHash,
      checks: out.checks,
    },
  });
  await store.set(key, result);
  return result;
}

// 여러 그림을 서로 모른 채 병렬 생성 · 한 그림의 실패는 그 그림에만 남는다(FIGURE-002 실패 복구)
/**
 * @param {Parameters<typeof renderFigure>[0]} deps
 * @param {{ candidate: Parameters<typeof renderFigure>[1], input: Parameters<typeof renderFigure>[2], ctx: Parameters<typeof renderFigure>[3] }[]} jobs
 */
export async function renderFigures(deps, jobs) {
  const settled = await Promise.allSettled(
    jobs.map(({ candidate, input, ctx }) => renderFigure(deps, candidate, input, ctx)),
  );
  return settled.map((s, i) =>
    s.status === "fulfilled"
      ? { id: jobs[i].candidate.id, ok: true, result: s.value }
      : { id: jobs[i].candidate.id, ok: false, error: String(s.reason?.message ?? s.reason) },
  );
}
