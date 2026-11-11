import { Compose } from "./compose/Compose";
import { useEditorialSession } from "./tracking/useEditorialSession";
import { Workspace } from "./workspace/Workspace";

export function App() {
  const session = useEditorialSession();
  return (
    <>
      <header className="flex items-center justify-between">
        <div className="brand flex items-center gap-2.5">
          AIN <span>글쓰기</span>
        </div>
        <button
          id="new"
          className="quiet"
          type="button"
          hidden={!session.id}
          onClick={session.compose}
        >
          새 글
        </button>
      </header>
      <main>
        <div id="notice" role="alert" hidden={!session.notice}>
          {session.notice}
        </div>
        <Compose
          hidden={Boolean(session.run)}
          submitting={session.submitting}
          recent={session.recent}
          focusVersion={session.focusVersion}
          onCreate={session.create}
          onOpen={session.open}
          onArchive={session.archive}
          onNotice={session.setNotice}
        />
        <Workspace
          run={session.run}
          online={session.online}
          submitting={session.submitting}
          onAction={session.action}
          onNotice={session.setNotice}
        />
      </main>
    </>
  );
}
