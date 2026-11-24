import { type FormEvent, useState } from "react";
import { FIGURE_LIMITS } from "../../../../contracts/figure.mjs";
import type { Figure } from "../../shared/api";
import { Icon } from "../../shared/Icon";
import type { Candidate } from "./plan";
import type { DecisionProps } from "./SkipFigures";
import { usePicked } from "./usePicked";

function DesignCandidate({
  candidate,
  motifs,
  onLocate,
}: {
  candidate: Candidate;
  motifs: Figure["motifs"];
  onLocate: (id: string) => void;
}) {
  return (
    <article className="figure-design-item">
      <h3>{candidate.section ? `‘${candidate.section}’ 구간` : "도입부"}</h3>
      <p>
        <b>주장</b> {candidate.claim}
      </p>
      <q>{candidate.anchor}</q>
      <button type="button" className="quiet" onClick={() => onLocate(candidate.id)}>
        <Icon name="eye" /> 본문에서 보기
      </button>
      {candidate.analogy && (
        <p>
          <b>그릴 대상</b> {candidate.analogy}
        </p>
      )}
      {candidate.scene && (
        <p>
          <b>장면</b> {candidate.scene}
        </p>
      )}
      {candidate.mapping.length > 0 && (
        <div>
          <b>요소와 개념</b>
          <ul>
            {candidate.mapping.map(({ element, concept }) => (
              <li key={`${element}:${concept}`}>
                {element} → {concept}
              </li>
            ))}
          </ul>
        </div>
      )}
      {candidate.motifs.length > 0 && (
        <p>
          <b>반복해서 나올 대상</b>{" "}
          {candidate.motifs
            .map((name) => {
              const motif = motifs.find((item) => item.name === name);
              return motif ? `${name} (${motif.look})` : name;
            })
            .join(" · ")}
        </p>
      )}
    </article>
  );
}

// 고른 자리의 구성을 한 번에 확인하고 승인하거나 선택한 곳을 다시 구성한다 · ADR-0026
export function FigureDesign({
  figure,
  disabled,
  onAction,
  onLocate,
}: Omit<DecisionProps, "run"> & { figure: Figure; onLocate: (id: string) => void }) {
  const candidates = figure.candidates.filter((candidate) =>
    figure.selected.includes(candidate.id),
  );
  const { picked, toggle } = usePicked(candidates.map(({ id }) => id));
  const [feedback, setFeedback] = useState(figure.feedback ?? "");
  const send = (event: FormEvent) => {
    event.preventDefault();
    void onAction({ type: "revise_design", feedback: feedback.trim(), figures: picked });
  };
  return (
    <section id="figure-design">
      <h2>그릴 내용 확인</h2>
      {figure.world && (
        <p className="figure-world">
          <b>장면 세계</b> {figure.world}
        </p>
      )}
      <div className="figure-design-list">
        {candidates.map((candidate) => (
          <DesignCandidate
            key={candidate.id}
            candidate={candidate}
            motifs={figure.motifs}
            onLocate={onLocate}
          />
        ))}
      </div>
      <div className="submit-row">
        <button
          id="approve-design"
          type="button"
          disabled={disabled}
          onClick={() => void onAction({ type: "approve_design" })}
        >
          <Icon name="check" /> 이대로 그리기
        </button>
      </div>
      <form id="revise-design" onSubmit={send}>
        <label htmlFor="design-feedback">고칠 의견</label>
        <textarea
          id="design-feedback"
          rows={3}
          maxLength={FIGURE_LIMITS.feedback}
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
          required
        />
        <fieldset className="figure-list">
          <legend>다시 구성할 자리</legend>
          {candidates.map((candidate, index) => (
            <label key={candidate.id}>
              <input
                type="checkbox"
                checked={picked.includes(candidate.id)}
                onChange={() => toggle(candidate.id)}
              />
              {candidate.section ? `‘${candidate.section}’ 구간` : `도입부`} · 자리 {index + 1}
            </label>
          ))}
        </fieldset>
        <div className="submit-row">
          <button
            id="revise-design-submit"
            type="submit"
            disabled={disabled || !feedback.trim() || !picked.length}
          >
            다시 구성
          </button>
        </div>
      </form>
    </section>
  );
}
