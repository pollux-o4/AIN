import { outputFields } from "../../../contracts/output-fields.mjs";
import {
  levelLabels,
  modeLabels,
  readerLevelSchema,
  sectionMode,
  sectionTitle,
  writingModeSchema,
} from "../../../contracts/writing-modes.mjs";
import { withOccurrenceKeys } from "./listKeys";

function evidence(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || !("claim" in item)) return [];
    if (typeof item.claim !== "string") return [];
    let url: string | null = null;
    if ("url" in item && typeof item.url === "string") {
      try {
        const parsed = new URL(item.url);
        if (["http:", "https:"].includes(parsed.protocol)) url = parsed.href;
      } catch {
        /* 출처 주소가 유효하지 않아도 근거 설명은 보존한다. */
      }
    }
    return [{ claim: item.claim, url }];
  });
}

function ResultField({ field, label, value }: { field: string; label: string; value: unknown }) {
  if (field === "evidence") {
    const items = evidence(value);
    return (
      <div>
        <dt>{label}</dt>
        <dd>
          {items.length ? (
            <ul>
              {withOccurrenceKeys(items).map(({ value: item, key }) => (
                <li key={key}>
                  <p>{item.claim}</p>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {item.url}
                    </a>
                  ) : (
                    <span className="hint">확인할 수 있는 출처 주소가 없습니다.</span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            "등록된 근거 없음"
          )}
        </dd>
      </div>
    );
  }
  if (field === "sections" && Array.isArray(value))
    return (
      <div>
        <dt>{label}</dt>
        <dd>
          <ol>
            {withOccurrenceKeys(value).map(({ value: section, key }) => {
              const mode = sectionMode(section);
              const point =
                section && typeof section === "object" && "keyPoint" in section
                  ? String(section.keyPoint)
                  : "";
              return (
                <li key={key}>
                  <p>
                    {sectionTitle(section)}
                    {mode && <span className="mode-tag">{modeLabels[mode]}</span>}
                  </p>
                  {point && <p className="hint">{point}</p>}
                </li>
              );
            })}
          </ol>
        </dd>
      </div>
    );
  const mode = field === "primaryMode" ? writingModeSchema.safeParse(value) : null;
  const level = field === "readerLevel" ? readerLevelSchema.safeParse(value) : null;
  if (mode?.success || level?.success)
    return (
      <div>
        <dt>{label}</dt>
        <dd>
          {mode?.success ? modeLabels[mode.data] : level?.success ? levelLabels[level.data] : ""}
        </dd>
      </div>
    );
  if (typeof value === "string")
    return (
      <div>
        <dt>{label}</dt>
        <dd className="artifact-text">{value}</dd>
      </div>
    );
  if (Array.isArray(value) && value.every((item: unknown) => typeof item === "string"))
    return (
      <div>
        <dt>{label}</dt>
        <dd>
          {value.length ? (
            <ul>
              {withOccurrenceKeys(value).map(({ value: item, key }) => (
                <li key={key}>{item}</li>
              ))}
            </ul>
          ) : (
            "없음"
          )}
        </dd>
      </div>
    );
  return null;
}

export function StageOutput({ stage, output }: { stage: string; output: Record<string, unknown> }) {
  return (
    <dl>
      {(outputFields[stage] ?? []).map(([field, label]) => (
        <ResultField key={field} field={field} label={label} value={output[field]} />
      ))}
    </dl>
  );
}
