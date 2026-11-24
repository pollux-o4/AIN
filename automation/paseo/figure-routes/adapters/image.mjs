// image 경로 · 이미지 생성 모델은 client 포트로 주입한다(Higgsfield MCP 등 교체 가능 · ADR-0025)

// 지시문은 스타일 → 장면 → 배치 → 글자 순서 · 섹션이 빠지면 예측 가능한 방식으로 실패한다(RES-009)
/** @param {import("../types.mjs").RouteInput} input @param {boolean} textInImage */
export function imagePrompt(input, textInImage) {
  const style = input.style ? Object.values(input.style).join(" / ") : "";
  const motifs = input.motifs.map((m) => `${m.name}: ${m.look}`);
  const sections = [
    ["Style", style],
    ["Message", input.message],
    ["Elements", input.elements.map((e) => e.name).join(", ")],
    ["Recurring objects", motifs.join("; ")],
    ["Layout", (input.regions ?? []).join("; ")],
    ["Direction", input.direction ?? ""],
    [
      "Text",
      textInImage
        ? `Render exactly these Korean labels: ${input.labels.map((l) => `"${l.text}"`).join(", ")}`
        : "No text, letters or numbers in the image.",
    ],
  ];
  return sections
    .filter(([, body]) => body)
    .map(([head, body]) => `${head}: ${body}`)
    .join("\n");
}

/**
 * @param {{
 *   id: string,
 *   version: string,
 *   textInImage: boolean,
 *   client: { generate(request: { prompt: string, dir: string, signal: AbortSignal }): Promise<{
 *     path: string, mime: string, alt: string, model: string, tokens: number | null,
 *     labels?: { text: string, anchor: { x: number, y: number } }[],
 *   }> },
 * }} options textInImage는 모델별로 다르다 · 기본값은 f4 비교 시험으로 정한다
 * @returns {import("../types.mjs").RouteAdapter}
 */
export function imageAdapter({ id, version, textInImage, client }) {
  return {
    id,
    route: "image",
    version,
    // shortcut: 래스터 움직임(영상)·부분 편집 미지원, 모델 어댑터가 지원을 선언하면 능력을 연다
    capabilities: { motion: false, textInImage, partialEdit: false, maxChecks: 0 },
    async render(input, ctx) {
      const made = await client.generate({
        prompt: imagePrompt(input, textInImage),
        dir: ctx.dir,
        signal: ctx.signal,
      });
      return {
        files: [{ path: made.path, mime: made.mime }],
        alt: made.alt,
        caption: null,
        motion: false,
        // 그림 안에 그렸으면 위치 없이, 아니면 client가 정한 위치에 화면이 얹는다
        labels: textInImage ? input.labels.map(({ text }) => ({ text })) : (made.labels ?? []),
        model: made.model,
        tokens: made.tokens,
        checks: 0,
      };
    },
  };
}
