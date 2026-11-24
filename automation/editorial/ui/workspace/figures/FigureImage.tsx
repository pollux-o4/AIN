import { useRef } from "react";
import { FIGURE_MOTION_ATTR, staticFigureSrc } from "../../../../contracts/figure.mjs";
import { type Figure, figureUrl, type Run } from "../../shared/api";
import { useFigureMotion } from "../../shared/useFigureMotion";

// 그림 결과 표시 · 위치가 있는 글자는 그림 위에 얹는다(그림 안에 그리지 않은 경우 · FIGURE-002 L1)
// 움직임은 화면에 보이는 그림만 · 나머지는 정지판(완료 상태)이라 여러 장을 훑어도 버벅이지 않는다
export function FigureImage({ run, item }: { run: Run; item: Figure["items"][number] }) {
  const placed = item.labels.filter((label) => label.anchor);
  const frame = useRef<HTMLSpanElement>(null);
  const src = figureUrl(run, item.id);
  useFigureMotion(frame, [src]);
  return (
    <span className="figure-image" ref={frame}>
      <img
        src={staticFigureSrc(src)}
        {...{ [FIGURE_MOTION_ATTR]: src }}
        alt={item.alt}
        decoding="async"
      />
      {placed.map(({ text, anchor }) => (
        <span
          key={text}
          className="figure-image-label"
          aria-hidden="true"
          style={{ left: `${(anchor?.x ?? 0) * 100}%`, top: `${(anchor?.y ?? 0) * 100}%` }}
        >
          {text}
        </span>
      ))}
    </span>
  );
}
