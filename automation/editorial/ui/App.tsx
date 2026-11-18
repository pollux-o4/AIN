import { useCallback, useEffect } from "react";
import { Compose } from "./compose/Compose";
import { Library } from "./library/Library";
import { Icon } from "./shared/Icon";
import { Settings } from "./shell/Settings";
import { Toaster } from "./shell/Toaster";
import { useEditorialSession } from "./tracking/useEditorialSession";
import { isPending } from "./tracking/useRunTracking";
import { Workspace } from "./workspace/Workspace";

type Session = ReturnType<typeof useEditorialSession>;

function RunPage({ session }: { session: Session }) {
  const { run, missing } = session;
  if (missing)
    return (
      <div className="state" role="alert">
        <h1>글을 찾을 수 없습니다</h1>
        <p className="hint">주소가 잘못됐거나 더 이상 없는 글입니다.</p>
        <button type="button" onClick={session.library}>
          내 글로 돌아가기
        </button>
      </div>
    );
  return (
    <>
      <div className="page-bar">
        <a
          href={location.pathname}
          onClick={(event) => {
            event.preventDefault();
            session.library();
          }}
        >
          <Icon name="back" />내 글
        </a>
        {run && !run.archived && !isPending(run.status) && (
          <button
            type="button"
            className="quiet archive"
            onClick={() => void session.archive({ id: run.id, title: run.title })}
          >
            <Icon name="trash" />
            삭제
          </button>
        )}
      </div>
      {run?.archived && (
        <div className="banner">
          <span>삭제된 글입니다. 목록에는 보이지 않습니다.</span>
          <button type="button" className="quiet" onClick={() => void session.restore(run.id)}>
            <Icon name="restore" />
            복원
          </button>
        </div>
      )}
      {!run && session.online && (
        <div className="state" aria-busy="true">
          <p className="hint">불러오는 중…</p>
        </div>
      )}
      <Workspace
        run={run}
        online={session.online}
        submitting={session.submitting}
        onAction={session.action}
        onNotice={session.setNotice}
      />
    </>
  );
}
export function App() {
  const session = useEditorialSession();
  const { route, setToast } = session;
  const closeToast = useCallback(() => setToast(null), [setToast]);
  useEffect(() => {
    const page =
      route.page === "compose"
        ? "새 글"
        : route.page === "run"
          ? (session.run?.title ?? "글")
          : "내 글";
    document.title = `${page} · AIN`;
  }, [route.page, session.run?.title]);
  return (
    <>
      <header className="flex items-center justify-between">
        <nav className="flex items-center gap-4" aria-label="주요 메뉴">
          <a
            className="brand flex items-center gap-2.5"
            href={location.pathname}
            onClick={(event) => {
              event.preventDefault();
              session.library();
            }}
          >
            AIN <span>글쓰기</span>
          </a>
          <a
            href={location.pathname}
            className="nav-link"
            aria-current={route.page === "library" ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              session.library();
            }}
          >
            내 글
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <button
            id="new"
            className="quiet"
            type="button"
            hidden={route.page !== "run"}
            onClick={session.compose}
          >
            <Icon name="plus" />새 글
          </button>
          <Settings />
        </div>
      </header>
      <main>
        <div id="notice" role="alert" hidden={!session.notice}>
          {session.notice}
          <button
            type="button"
            className="dismiss"
            aria-label="알림 닫기"
            onClick={() => session.setNotice("")}
          >
            ×
          </button>
        </div>
        {route.page === "library" && (
          <Library
            runs={session.recent}
            error={session.listError}
            onRetry={session.refreshList}
            onOpen={session.open}
            onCompose={session.compose}
            onArchive={session.archive}
          />
        )}
        {route.page === "compose" && (
          <Compose
            submitting={session.submitting}
            onCreate={session.create}
            onNotice={session.setNotice}
          />
        )}
        {route.page === "run" && <RunPage session={session} />}
      </main>
      <Toaster toast={session.toast} onClose={closeToast} />
    </>
  );
}
