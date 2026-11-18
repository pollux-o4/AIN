import { useEffect, useState } from "react";
import { api, type HistoryRecord, type Run, type WritingJourneyEntry } from "../shared/api";
import { StageOutput } from "../shared/StageOutput";
import { StepFeed } from "./LiveActivity";
import { type RevisionSlot, type StageTurn, stageTurns } from "./stageTurns";

type History = { records: HistoryRecord[]; journey: WritingJourneyEntry[] };

// 지도에서 고른 단계의 회차별 기록 · 결정 요지 → 입력·근거 → 재시도 → 실행 로그 순으로 펼친다
export function StageLog({ run, stage }: { run: Run; stage: string }) {
  const [history, setHistory] = useState<History | null>(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setFailed(false);
    api.history(run.id).then(
      (data) => live && setHistory(data),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [run.id]);
  if (failed) return <p className="hint">기록을 불러오지 못했어요. 잠시 후 다시 열어 주세요.</p>;
  if (!history)
    return (
      <p className="hint" aria-busy="true">
        기록을 불러오는 중…
      </p>
    );
  const { turns, source, slots } = stageTurns(
    history.records,
    history.journey,
    stage,
    run.revision,
  );
  if (!turns.length) return <p className="hint">이 단계는 남은 진행 기록이 없어요.</p>;
  const selected =
    turns.find((turn) => turn.revision === picked) ?? source ?? (turns.at(-1) as StageTurn);
  return (
    <div className="stage-log">
      <p className="stage-origin">
        {source
          ? source.revision === run.revision
            ? `지금 결과는 이번 초안 ${run.revision}에서 만들었어요.`
            : `지금 결과는 초안 ${source.revision}에서 만들고 이후 그대로 쓰고 있어요.`
          : "아직 완료된 결과가 없어요."}
      </p>
      {turns.length > 1 && (
        <TurnPicker slots={slots} selected={selected.revision} onPick={setPicked} />
      )}
      <TurnDetail turn={selected} isSource={selected === source} />
    </div>
  );
}

// 연속으로 실행이 없던 회차는 하나로 묶는다 · 빈 회차가 기록 누락으로 읽히지 않게
function groups(slots: RevisionSlot[]) {
  const out: ({ turn: StageTurn } | { kept: [number, number] })[] = [];
  for (const slot of slots) {
    const last = out.at(-1);
    if (slot.turn) out.push({ turn: slot.turn });
    else if (last && "kept" in last) last.kept[1] = slot.revision;
    else out.push({ kept: [slot.revision, slot.revision] });
  }
  return out;
}

function TurnPicker({
  slots,
  selected,
  onPick,
}: {
  slots: RevisionSlot[];
  selected: number;
  onPick: (revision: number) => void;
}) {
  return (
    <ol className="turn-picker" aria-label="이 단계가 실행된 회차">
      {groups(slots).map((group) =>
        "turn" in group ? (
          <li key={group.turn.revision}>
            <button
              type="button"
              className="dock-chip"
              aria-pressed={group.turn.revision === selected}
              onClick={() => onPick(group.turn.revision)}
            >
              초안 {group.turn.revision}
            </button>
          </li>
        ) : (
          <li key={`kept-${group.kept[0]}`} className="hint">
            {group.kept[0] === group.kept[1]
              ? `초안 ${group.kept[0]}`
              : `초안 ${group.kept[0]}–${group.kept[1]}`}{" "}
            유지
          </li>
        ),
      )}
    </ol>
  );
}

// shortcut: 직전 회차 대비 변화는 회차 전환으로 비교, 단계 산출물 필드별 diff 요구가 생기면 추가
function TurnDetail({ turn, isSource }: { turn: StageTurn; isSource: boolean }) {
  const { result, attempts } = turn;
  const retries = attempts.filter((attempt) => attempt !== result);
  return (
    <article className="turn-detail" aria-label={`초안 ${turn.revision} 실행`}>
      <h3>
        초안 {turn.revision}
        {isSource ? " · 지금 쓰는 결과" : ""}
      </h3>
      {result.output ? (
        <StageOutput stage={result.stage} output={result.output} />
      ) : (
        <p className="hint">{result.reason ?? "이 실행은 결과를 남기지 못했어요."}</p>
      )}
      {(turn.request || result.reason || result.inputs.length > 0 || result.model) && (
        <details>
          <summary>이 회차의 요청과 판단 근거</summary>
          {turn.request && (
            <p className="turn-request">
              <span className="hint">요청</span> {turn.request}
            </p>
          )}
          {result.reason && <p>{result.reason}</p>}
          {result.inputs.length > 0 && (
            <p className="hint">사용한 자료: {result.inputs.join(" · ")}</p>
          )}
          {result.model && <p className="hint">AI: {result.model}</p>}
        </details>
      )}
      {retries.length > 0 && (
        <details>
          <summary>같은 회차의 다른 실행 {retries.length}번</summary>
          <ol>
            {retries.map((attempt) => (
              <li key={attempt.key}>
                {attempt.label}
                {attempt.reason && <p className="hint">{attempt.reason}</p>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {result.steps.length > 0 && (
        <details>
          <summary>실행 로그</summary>
          <StepFeed steps={result.steps} />
        </details>
      )}
    </article>
  );
}
