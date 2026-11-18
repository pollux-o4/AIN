import { useState } from "react";
import { AI_MODELS } from "../../../contracts/ai-models.mjs";
import { INPUT_LIMITS } from "../../../contracts/requests.mjs";
import type { Direction } from "../shared/api";
import { Icon } from "../shared/Icon";
import { inputSchema, keys, read, storageWarning, store } from "../shared/persistence";
import { DirectionPicker } from "./DirectionPicker";

type Props = {
  submitting: boolean;
  onCreate: (idea: string, source: string, direction: Direction) => Promise<void>;
  onNotice: (message: string) => void;
};
export function Compose({ submitting, onCreate, onNotice }: Props) {
  const [input, setInput] = useState(() => read(keys.input, inputSchema) ?? inputSchema.parse({}));
  const [sourceOpen, setSourceOpen] = useState(Boolean(input.source));
  function update<K extends "idea" | "source" | "direction">(field: K, value: (typeof input)[K]) {
    const next = { ...input, [field]: value };
    setInput(next);
    if (!store(keys.input, next)) onNotice(storageWarning);
  }
  return (
    <section id="compose" aria-labelledby="compose-title">
      <h1 id="compose-title">어떤 글을 쓸까요?</h1>
      <form
        id="create-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onCreate(input.idea.trim(), input.source, input.direction);
        }}
      >
        <label htmlFor="idea">글감과 원하는 결과</label>
        <textarea
          // biome-ignore lint/a11y/noAutofocus: 새 글 화면의 유일한 주 입력
          autoFocus
          id="idea"
          name="idea"
          required
          maxLength={INPUT_LIMITS.idea}
          rows={5}
          value={input.idea}
          onChange={(e) => update("idea", e.target.value)}
          placeholder="예: SOA부터 모듈러 모놀리스까지, 왜 구조가 달라졌는지 초보 개발자에게 쉽게 설명하고 싶어요."
        />
        <DirectionPicker
          value={input.direction}
          onChange={(direction) => update("direction", direction)}
        />
        <details
          id="source-options"
          open={sourceOpen}
          onToggle={(e) => setSourceOpen(e.currentTarget.open)}
        >
          <summary>참고 자료</summary>
          <label htmlFor="source">원문·확인한 내용</label>
          <p id="source-hint" className="hint">
            링크만으로는 원문을 읽지 않습니다.
          </p>
          <textarea
            id="source"
            name="source"
            maxLength={INPUT_LIMITS.source}
            rows={5}
            aria-describedby="source-hint"
            value={input.source}
            onChange={(e) => update("source", e.target.value)}
            placeholder="참고할 본문과 확인한 사실을 붙여 넣어 주세요."
          />
        </details>
        <div className="submit-row">
          <p className="hint">{AI_MODELS.standard.label} · 입력은 AI 제공자에게 전달됩니다.</p>
          <button type="submit" id="create" disabled={submitting}>
            {!submitting && <Icon name="pen" />}
            {submitting ? "요청 중…" : "초안 만들기"}
          </button>
        </div>
      </form>
    </section>
  );
}
