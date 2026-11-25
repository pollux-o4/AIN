import { FIGURE_LOOKS } from "../../../../contracts/figure.mjs";
import { type LookId, lookName, type motifPeers } from "./plan";

// 그림체 바꾸기 · 지금 그림체를 보여 주고, 같은 대상이 나오는 자리는 함께 바꿀지 묻는다(ADR-0027)
// 기본은 함께 바꾸기 · 같은 대상이 그림마다 다르게 그려지면 독자가 같은 것으로 알아보기 어렵다(ADR-0022)
export function LookSelect({
  id,
  current,
  value,
  onChange,
  peers,
  withPeers,
  onWithPeers,
}: {
  id: string;
  current: string | null;
  value: LookId | "";
  onChange: (look: LookId | "") => void;
  peers: ReturnType<typeof motifPeers>;
  withPeers: boolean;
  onWithPeers: (on: boolean) => void;
}) {
  const changed = Boolean(value) && value !== current;
  return (
    <div className="look-select">
      <label htmlFor={id}>
        그림체
        <span className="hint">지금: {lookName(current) ?? "자동"}</span>
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as LookId | "")}
      >
        <option value="">그대로 두기</option>
        {Object.entries(FIGURE_LOOKS).map(([look, spec]) => (
          <option key={look} value={look} disabled={look === current}>
            {spec.label} · {spec.fits}
          </option>
        ))}
      </select>
      {changed && peers.ids.length > 0 && (
        <label className="look-peers">
          <input
            type="checkbox"
            checked={withPeers}
            onChange={(event) => onWithPeers(event.target.checked)}
          />
          같은 대상({peers.names.join(", ")})이 나오는 그림 {peers.ids.length}개도 함께 바꾸기
        </label>
      )}
    </div>
  );
}
