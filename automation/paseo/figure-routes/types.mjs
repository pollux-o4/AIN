// 경로 어댑터 계약 타입 · 실행 코드는 없다(FIGURE-002 L2)

/**
 * @typedef {{
 *   message: string,
 *   elements: { name: string, quote: string }[],
 *   regions?: string[],
 *   moving?: string[],
 *   labels: { text: string }[],
 *   style: Record<string, string> | null,
 *   motifs: { name: string, look: string }[],
 *   direction: string | null,
 * }} RouteInput 두 경로 공통 입력 · 다른 그림의 결과는 넣지 않는다(ADR-0022)
 *
 * @typedef {{ dir: string, signal: AbortSignal }} RouteContext 작업 폴더와 취소 신호 · 비밀값은 어댑터가 생성자로 받는다
 *
 * @typedef {{
 *   files: { path: string, mime: string }[],
 *   alt: string,
 *   caption: string | null,
 *   motion: boolean,
 *   labels: { text: string, anchor?: { x: number, y: number } }[],
 *   model: string | null,
 *   tokens: number | null,
 *   checks: number,
 * }} RouteOutput 어댑터 산출 · 크기·시간·해시는 실행기가 직접 잰다
 *
 * @typedef {{
 *   id: string,
 *   route: "image" | "svg",
 *   version: string,
 *   capabilities: { motion: boolean, textInImage: boolean, partialEdit: boolean, maxChecks: number },
 *   render: (input: RouteInput, ctx: RouteContext) => Promise<RouteOutput>,
 * }} RouteAdapter
 */
export {};
