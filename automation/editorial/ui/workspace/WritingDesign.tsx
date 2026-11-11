import { levelLabels, modeLabels } from "../../../contracts/writing-modes.mjs";
import type { Design } from "../shared/api";
import { withOccurrenceKeys } from "../shared/listKeys";

const by = { user: "직접 고름", ai: "AI 판단" } as const;

export function WritingDesign({ design }: { design: Design }) {
  const mixed = new Set(design.sections.map((section) => section.mode).filter(Boolean)).size > 1;
  if (!design.mode && !design.readerLevel && !design.sections.length) return null;
  return (
    <section id="writing-design" aria-labelledby="writing-design-title">
      <h2 id="writing-design-title">글 설계</h2>
      <dl className="design-facts">
        {design.mode && (
          <div>
            <dt>글의 성격</dt>
            <dd>
              {modeLabels[design.mode]}
              {mixed && " 중심 · 구간별 혼합"}
              {design.modeBy && <small>{by[design.modeBy]}</small>}
            </dd>
          </div>
        )}
        {design.readerLevel && (
          <div>
            <dt>독자 수준</dt>
            <dd>
              {levelLabels[design.readerLevel]}
              {design.levelBy && <small>{by[design.levelBy]}</small>}
            </dd>
          </div>
        )}
      </dl>
      {design.sections.length > 0 && (
        <details id="design-sections">
          <summary>구간 {design.sections.length}개 보기</summary>
          <ol>
            {withOccurrenceKeys(design.sections).map(({ value: section, key }) => (
              <li key={key}>
                <span>{section.title}</span>
                {section.mode && <span className="mode-tag">{modeLabels[section.mode]}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
