import { useState } from "react";
import { INPUT_LIMITS } from "../../../contracts/requests.mjs";
import type { ActionCommand, BriefEdit, Run } from "../shared/api";

// 수정 해석 승인: 편집장 해석을 사람이 확인·보정한 뒤 수정 루프 착수 · ADR-0010
const TARGETS = [
  ["audience", "독자부터 다시"],
  ["value", "핵심 가치부터 다시"],
  ["outline", "구성부터 다시"],
  ["draft", "구성 유지, 초고만 다시"],
] as const;
type Target = (typeof TARGETS)[number][0];
const isTarget = (value: unknown): value is Target => TARGETS.some(([key]) => key === value);
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
const same = (a: string[] = [], b: string[]) => a.join("\n") === b.join("\n");

type Brief = NonNullable<Run["brief"]>;

// 사람이 바꾼 항목만 보냄 · 바꾼 것이 없으면 그대로 승인
function changes(brief: Brief, form: FormState): BriefEdit | undefined {
  const edit: BriefEdit = {};
  if (form.intent.trim() && form.intent.trim() !== brief.intent) edit.intent = form.intent.trim();
  if (form.target !== brief.target && isTarget(form.target)) edit.target = form.target;
  const priorities = lines(form.priorities);
  if (!same(brief.priorities, priorities)) edit.priorities = priorities;
  const preserve = lines(form.preserve);
  if (!same(brief.preserve, preserve)) edit.preserve = preserve;
  return Object.keys(edit).length ? edit : undefined;
}
type FormState = { intent: string; target: string; priorities: string; preserve: string };

export function BriefApproval({
  brief,
  disabled,
  onAction,
}: {
  brief: Brief;
  disabled: boolean;
  onAction: (command: ActionCommand) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => ({
    intent: brief.intent,
    target: brief.target ?? "draft",
    priorities: (brief.priorities ?? []).join("\n"),
    preserve: (brief.preserve ?? []).join("\n"),
  }));
  const [note, setNote] = useState("");
  const set = (key: keyof FormState) => (event: { target: { value: string } }) =>
    setForm((old) => ({ ...old, [key]: event.target.value }));
  const edit = changes(brief, form);
  return (
    <form
      id="brief-approval"
      aria-describedby="brief-approval-hint"
      onSubmit={(event) => {
        event.preventDefault();
        void onAction({ type: "approve_brief", ...(edit ? { edit } : {}) });
      }}
    >
      <p id="brief-approval-hint" className="hint">
        수정을 시작하기 전에 해석을 확인해 주세요. 고친 내용은 그대로 반영됩니다.
      </p>
      <label htmlFor="brief-intent">의도</label>
      <textarea
        id="brief-intent"
        rows={2}
        maxLength={1000}
        value={form.intent}
        onChange={set("intent")}
      />
      <label htmlFor="brief-target">어디부터 고칠까요</label>
      <select id="brief-target" value={form.target} onChange={set("target")}>
        {TARGETS.map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </select>
      <label htmlFor="brief-priorities">우선순위 (한 줄에 하나)</label>
      <textarea
        id="brief-priorities"
        rows={3}
        value={form.priorities}
        onChange={set("priorities")}
      />
      <label htmlFor="brief-preserve">살릴 것 (한 줄에 하나)</label>
      <textarea id="brief-preserve" rows={3} value={form.preserve} onChange={set("preserve")} />
      {brief.requirementChanges?.length ? (
        <div className="brief-assumptions">
          <p>
            요구 변경 (승인하면 이후 단계가 이 값을 따릅니다 · 다르면 해석 보정으로 바로잡아 주세요)
          </p>
          <ul>
            {brief.requirementChanges.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {brief.assumptions?.length ? (
        <div className="brief-assumptions">
          <p>근거 없이 정한 것 (다르면 위에서 고쳐 주세요)</p>
          <ul>
            {brief.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="submit-row">
        <button id="brief-approve" type="submit" disabled={disabled}>
          {edit ? "고친 해석으로 진행" : "이대로 진행"}
        </button>
      </div>
      <label htmlFor="brief-note">해석이 크게 다르면 다시 해석 요청</label>
      <textarea
        id="brief-note"
        rows={2}
        maxLength={INPUT_LIMITS.feedback}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="예: 구성은 그대로 두고 문장만 줄여 주세요."
      />
      <div className="submit-row">
        <button
          id="brief-revise"
          type="button"
          className="quiet"
          disabled={disabled || !note.trim()}
          onClick={() => void onAction({ type: "revise_brief", feedback: note.trim() })}
        >
          다시 해석
        </button>
      </div>
    </form>
  );
}
