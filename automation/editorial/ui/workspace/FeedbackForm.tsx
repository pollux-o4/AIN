import { useEffect, useRef } from "react";
import { INPUT_LIMITS } from "../../../contracts/requests.mjs";
import type { ActionCommand } from "../shared/api";

// 읽다가 바로 적는 수정 요청 · 자주 쓰는 요청은 칩으로 넣고 뺀다.
const presets = [
  "독자를 입문자로 낮춰 주세요.",
  "전문 용어는 처음 나올 때 풀어 주세요.",
  "예시를 더 구체적으로 넣어 주세요.",
  "분량을 줄여 핵심만 남겨 주세요.",
] as const;

type Props = {
  text: string;
  disabled: boolean;
  autoFocus: boolean;
  onWrite: (text: string) => void;
  onAction: (command: ActionCommand) => Promise<void>;
  onSent: () => void;
};

export function FeedbackForm({ text, disabled, autoFocus, onWrite, onAction, onSent }: Props) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) field.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const togglePreset = (preset: string) =>
    onWrite(
      text.includes(preset)
        ? text
            .replace(preset, "")
            .replace(/\n{2,}/g, "\n")
            .trim()
        : [text.trim(), preset].filter(Boolean).join("\n"),
    );
  return (
    <form
      id="feedback-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onAction({ type: "feedback", feedback: text }).then(onSent);
      }}
    >
      <label htmlFor="feedback">어떻게 다듬을까요?</label>
      <fieldset className="dock-presets">
        <legend className="sr-only">자주 쓰는 요청</legend>
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className="dock-chip"
            aria-pressed={text.includes(preset)}
            onClick={() => togglePreset(preset)}
          >
            {preset.replace(/ (주세요|줘)\.$/, "")}
          </button>
        ))}
      </fieldset>
      <textarea
        id="feedback"
        ref={field}
        required
        maxLength={INPUT_LIMITS.feedback}
        rows={3}
        value={text}
        onChange={(event) => onWrite(event.target.value)}
        placeholder="읽다가 걸린 곳을 적어 주세요. 예: 2구간 예시를 쉬운 말로."
      />
      <div className="submit-row">
        <span className="hint">Esc로 접기 · 적은 내용은 남아요</span>
        <button id="feedback-submit" type="submit" disabled={disabled}>
          수정 요청
        </button>
      </div>
    </form>
  );
}
