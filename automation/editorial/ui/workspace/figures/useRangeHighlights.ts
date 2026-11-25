import { useEffect } from "react";
import type { Picked } from "./textIndex";

// 본문 범위 표시 · CSS Custom Highlight API로 칠해 본문 DOM을 바꾸지 않는다(ADR-0030)
// 이름은 style.css의 ::highlight()와 같다
const HIGHLIGHTS = {
  candidate: "figure-range",
  focus: "figure-range-focus",
  pick: "figure-pick",
} as const;
type Layers = Partial<Record<keyof typeof HIGHLIGHTS, Array<Picked | null | undefined>>>;

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS;

export function useRangeHighlights(layers: Layers) {
  useEffect(() => {
    if (!supported()) return;
    const names = Object.keys(HIGHLIGHTS) as Array<keyof typeof HIGHLIGHTS>;
    for (const key of names) {
      const ranges = (layers[key] ?? []).flatMap((picked) => (picked ? [picked.range] : []));
      if (ranges.length) CSS.highlights.set(HIGHLIGHTS[key], new Highlight(...ranges));
      else CSS.highlights.delete(HIGHLIGHTS[key]);
    }
    return () => {
      for (const key of names) CSS.highlights.delete(HIGHLIGHTS[key]);
    };
  });
}
