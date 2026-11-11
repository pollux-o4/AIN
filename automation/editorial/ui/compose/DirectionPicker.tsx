import {
  AUTO,
  levelLabels,
  modeHints,
  modeLabels,
  READER_LEVELS,
  WRITING_MODES,
} from "../../../contracts/writing-modes.mjs";
import type { Direction } from "../shared/api";

type Option = { value: string; label: string };
const modeOptions: Option[] = [
  { value: AUTO, label: "자동" },
  ...WRITING_MODES.map((mode) => ({ value: mode, label: modeLabels[mode] })),
];
const levelOptions: Option[] = [
  { value: AUTO, label: "자동" },
  ...READER_LEVELS.map((level) => ({ value: level, label: levelLabels[level] })),
];
const levelHints: Record<string, string> = {
  beginner: "용어를 풀고 예시를 촘촘히 둡니다.",
  intermediate: "핵심 용어만 풀고 흐름에 집중합니다.",
  expert: "풀이를 줄이고 판단 근거를 앞에 둡니다.",
};

function Choices({
  name,
  legend,
  options,
  value,
  hint,
  onChange,
}: {
  name: string;
  legend: string;
  options: Option[];
  value: string;
  hint: string;
  onChange: (value: string) => void;
}) {
  const hintId = `${name}-hint`;
  return (
    <fieldset className="choices" aria-describedby={hintId}>
      <legend>{legend}</legend>
      <div className="choice-row">
        {options.map((option) => (
          <label key={option.value} className="choice">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <p id={hintId} className="hint">
        {hint}
      </p>
    </fieldset>
  );
}

export function DirectionPicker({
  value,
  onChange,
}: {
  value: Direction;
  onChange: (value: Direction) => void;
}) {
  const modeHint =
    value.mode === AUTO
      ? "글감을 보고 AI가 정합니다. 필요하면 구간마다 방식을 섞습니다."
      : `${modeHints[value.mode]}을 기본으로, 필요한 구간만 다른 방식을 섞습니다.`;
  const levelHint =
    value.readerLevel === AUTO
      ? "글감에 적힌 독자를 보고 AI가 정합니다."
      : levelHints[value.readerLevel];
  return (
    <div id="direction" className="direction">
      <Choices
        name="mode"
        legend="글의 성격"
        options={modeOptions}
        value={value.mode}
        hint={modeHint}
        onChange={(mode) => onChange({ ...value, mode: mode as Direction["mode"] })}
      />
      <Choices
        name="reader-level"
        legend="독자 수준"
        options={levelOptions}
        value={value.readerLevel}
        hint={levelHint}
        onChange={(readerLevel) =>
          onChange({ ...value, readerLevel: readerLevel as Direction["readerLevel"] })
        }
      />
    </div>
  );
}
