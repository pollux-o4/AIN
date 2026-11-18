import { useMemo, useState } from "react";
import type { RecentRun } from "../shared/api";
import { Icon } from "../shared/Icon";
import { isPending } from "../tracking/useRunTracking";

type Props = {
  runs: RecentRun[] | null;
  error: string;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onCompose: () => void;
  onArchive: (run: RecentRun) => void;
};
const relative = new Intl.RelativeTimeFormat("ko", { numeric: "auto" });
function updatedLabel(at: number | null | undefined) {
  if (!at) return "";
  const minutes = Math.round((at - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return new Date(at).toLocaleDateString("ko", { month: "short", day: "numeric" });
}
function tone(status: string) {
  if (isPending(status)) return "busy";
  if (status === "failed" || status === "paused") return "warn";
  return "ready";
}
export function Library({ runs, error, onRetry, onOpen, onCompose, onArchive }: Props) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (runs ?? []).filter((run) => !q || run.title.toLowerCase().includes(q));
  }, [runs, query]);
  return (
    <section id="library" aria-labelledby="library-title">
      <div className="library-head">
        <h1 id="library-title">내 글</h1>
        <button type="button" onClick={onCompose}>
          <Icon name="plus" />새 글 쓰기
        </button>
      </div>
      {runs && runs.length > 0 && (
        <div className="search">
          <Icon name="search" />
          <input
            id="library-search"
            type="search"
            placeholder="제목으로 찾기"
            aria-label="제목으로 찾기"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      {error && !runs && (
        <div className="state" role="alert">
          <p>{error}</p>
          <button type="button" className="quiet" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      )}
      {!runs && !error && (
        <ul className="run-list" aria-busy="true" aria-label="불러오는 중">
          {[0, 1, 2].map((i) => (
            <li key={i} className="skeleton" />
          ))}
        </ul>
      )}
      {runs?.length === 0 && (
        <div className="state empty">
          <span className="empty-art" aria-hidden="true">
            <Icon name="pen" size={48} />
          </span>
          <p>아직 쓴 글이 없습니다.</p>
          <p className="hint">글감을 적으면 AI가 진단부터 초고·검토까지 진행합니다.</p>
          <button type="button" onClick={onCompose}>
            <Icon name="plus" />첫 글 쓰기
          </button>
        </div>
      )}
      {runs && runs.length > 0 && shown.length === 0 && (
        <p className="state hint">'{query}'와 맞는 글이 없습니다.</p>
      )}
      {shown.length > 0 && (
        <ul id="recent" className="run-list">
          {shown.map((run) => (
            <li key={run.id} data-id={run.id}>
              <a
                className="open"
                href={`#${run.id}`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                  event.preventDefault();
                  onOpen(run.id);
                }}
              >
                <span className="run-title">{run.title}</span>
                <small>
                  <span className={`chip ${tone(run.status)}`}>{run.label}</span>
                  초안 {run.revision}
                  {run.updatedAt ? ` · ${updatedLabel(run.updatedAt)}` : ""}
                </small>
              </a>
              <button
                type="button"
                className="quiet archive"
                hidden={isPending(run.status)}
                aria-label={`${run.title} 삭제`}
                onClick={() => onArchive(run)}
              >
                <Icon name="trash" />
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
