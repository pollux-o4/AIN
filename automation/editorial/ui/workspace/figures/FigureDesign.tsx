import { type FormEvent, useState } from "react";
import { FIGURE_LIMITS } from "../../../../contracts/figure.mjs";
import type { Figure } from "../../shared/api";
import { Icon } from "../../shared/Icon";
import { AnchorQuote } from "./Locate";
import { LookSelect } from "./LookSelect";
import { type Candidate, type LookId, lookName, motifIndex, motifPeers, placeName } from "./plan";
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
  const looks = motifIndex(motifs);
  return (
    <article className="figure-design-item">
      <h3>{placeName(candidate.section)}</h3>
      <p>
        <b>주장</b> {candidate.claim}
      </p>
      <AnchorQuote text={candidate.anchor} id={candidate.id} onLocate={onLocate} />
      {candidate.look && (
        <p>
          <b>그림체</b> {lookName(candidate.look)}
          {candidate.lookBy === "user" ? " · 직접 고름" : ""}
        </p>
      )}
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
              const motif = looks.get(name);
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
  const [look, setLook] = useState<LookId | "">("");
  const [withPeers, setWithPeers] = useState(true);
  const text = feedback.trim();
  // 고른 자리와 같은 대상이 나오는 자리 · 그림체만 바꿀 때 함께 바꿀지 묻는다(ADR-0022·0027)
  const peerIds = new Set(picked.flatMap((id) => motifPeers(candidates, id).ids));
  for (const id of picked) peerIds.delete(id);
  const peers = {
    ids: [...peerIds],
    names: [...new Set(picked.flatMap((id) => motifPeers(candidates, id).names))],
  };
  const targets = look && withPeers ? [...picked, ...peers.ids] : picked;
  const send = (event: FormEvent) => {
    event.preventDefault();
    void onAction({
      type: "revise_design",
      figures: targets,
      ...(text ? { feedback: text } : {}),
      ...(look ? { look } : {}),
    });
  };
  const shared = new Set(picked.map((id) => candidates.find((c) => c.id === id)?.look ?? null));
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
              {placeName(candidate.section)} · 자리 {index + 1}
            </label>
          ))}
        </fieldset>
        <LookSelect
          id="design-look"
          current={shared.size === 1 ? [...shared][0] : null}
          value={look}
          onChange={setLook}
          peers={peers}
          withPeers={withPeers}
          onWithPeers={setWithPeers}
        />
        <div className="submit-row">
          <button
            id="revise-design-submit"
            type="submit"
            disabled={disabled || !(text || look) || !picked.length}
          >
            다시 구성
          </button>
        </div>
      </form>
    </section>
  );
}
