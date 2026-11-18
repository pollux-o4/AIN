import { type Figure, figureUrl, type Run } from "../../shared/api";

// 그림 결과 표시 · 위치가 있는 글자는 그림 위에 얹는다(그림 안에 그리지 않은 경우 · FIGURE-002 L1)
export function FigureImage({ run, item }: { run: Run; item: Figure["items"][number] }) {
  const placed = item.labels.filter((label) => label.anchor);
  return (
    <span className="figure-image">
      <img src={figureUrl(run, item.id)} alt={item.alt} />
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
