import {
  effectiveRoute,
  FIGURE_ROUTES,
  figureCapabilitiesSchema,
} from "../../contracts/figure-result.mjs";

// 경로 어댑터 등록소 · 경로마다 어댑터 하나(전략) · 선택 규칙만 알고 그리는 법은 모른다(FIGURE-002 L2)
export class RouteRegistry {
  /** @type {Map<string, import("./types.mjs").RouteAdapter>} */
  #byRoute = new Map();

  /** @param {import("./types.mjs").RouteAdapter[]} adapters */
  constructor(adapters) {
    for (const adapter of adapters) {
      if (!FIGURE_ROUTES.includes(adapter.route))
        throw new Error(`Unknown route: ${adapter.route}`);
      if (this.#byRoute.has(adapter.route))
        throw new Error(`Duplicate adapter for ${adapter.route}`);
      if (typeof adapter.id !== "string" || typeof adapter.render !== "function")
        throw new Error("Adapter must have id and render");
      figureCapabilitiesSchema.parse(adapter.capabilities);
      this.#byRoute.set(adapter.route, adapter);
    }
  }

  // 사람 지정 경로 → 유형 기본 경로 · 어댑터가 없으면 다른 경로로 바꾸지 않고 실패한다
  /** @param {{ kind: string | null, route?: string | null }} candidate */
  select(candidate) {
    const route = effectiveRoute(candidate);
    const adapter = this.#byRoute.get(route);
    if (!adapter) throw new Error(`No adapter for route: ${route}`);
    return adapter;
  }
}
