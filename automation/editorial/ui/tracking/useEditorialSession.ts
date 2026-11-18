import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ActionCommand,
  ApiError,
  api,
  type Direction,
  errorMessage,
  type RecentRun,
} from "../shared/api";
import {
  clearOperation,
  createRequest,
  keys,
  pendingAction,
  remove,
  savedFeedback,
  storageWarning,
  store,
} from "../shared/persistence";
import { type Route, useRoute } from "../shell/route";
import { isPending, useRunTracking } from "./useRunTracking";

export type Toast = { message: string; undo?: () => void };
export function useEditorialSession() {
  const { route, navigate } = useRoute();
  const id = route.page === "run" ? route.id : null;
  const [notice, setNotice] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useState<RecentRun[] | null>(null);
  const [listError, setListError] = useState("");
  const [listVersion, setListVersion] = useState(0);
  const busy = useRef(false);
  const selected = useRef(id);
  const navigation = useRef(0);
  const { run, online, reload, missing } = useRunTracking(id, setNotice);
  const persist = useCallback((key: string, value: unknown) => {
    if (!store(key, value)) setNotice(storageWarning);
  }, []);
  const go = useCallback(
    (next: Route) => {
      ++navigation.current;
      selected.current = next.page === "run" ? next.id : null;
      setNotice("");
      navigate(next);
    },
    [navigate],
  );
  const open = useCallback((next: string) => go({ page: "run", id: next }), [go]);
  const compose = useCallback(() => {
    remove(keys.create);
    go({ page: "compose" });
  }, [go]);
  const library = useCallback(() => go({ page: "library" }), [go]);
  useEffect(() => {
    selected.current = id;
  }, [id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: listVersion은 수동 새로고침 신호
  useEffect(() => {
    if (route.page !== "library") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function list() {
      try {
        const data = await api.list();
        if (disposed) return;
        setRecent(data.runs);
        setListError("");
        if (data.runs.some((item) => isPending(item.status)))
          timer = setTimeout(() => void list(), 3000);
      } catch (error) {
        if (disposed) return;
        setListError(errorMessage(error));
        timer = setTimeout(() => void list(), 5000);
      }
    }
    void list();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [route.page, listVersion]);
  const refreshList = useCallback(() => setListVersion((v) => v + 1), []);
  async function create(idea: string, source: string, direction: Direction) {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setNotice("");
    const generation = navigation.current;
    try {
      const pending = createRequest(idea, source, direction);
      persist(keys.create, pending);
      const next = await api.create({ requestId: pending.requestId, idea, source, direction });
      if (navigation.current === generation) open(next.id);
    } catch (error) {
      if (navigation.current === generation)
        setNotice(`${errorMessage(error)} 입력은 그대로 보존했습니다.`);
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }
  async function restore(targetId: string) {
    try {
      await api.restore(targetId);
      setToast({ message: "글을 복원했습니다." });
      refreshList();
      if (selected.current === targetId) await reload();
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }
  // 삭제는 목록에서 숨김(원고 보존)이라 확인창 대신 되돌리기를 제공한다.
  async function archive(target: { id: string; title: string }) {
    try {
      await api.archive(target.id);
      setRecent((runs) => runs?.filter((item) => item.id !== target.id) ?? runs);
      setToast({
        message: `'${target.title}'을(를) 삭제했습니다.`,
        undo: () => void restore(target.id),
      });
      if (selected.current === target.id) library();
    } catch (error) {
      setNotice(errorMessage(error));
    }
  }
  async function action(command: ActionCommand) {
    if (busy.current || !run || !online) return;
    busy.current = true;
    setSubmitting(true);
    const target = run;
    const generation = navigation.current;
    const active = () => navigation.current === generation && selected.current === target.id;
    try {
      const pending = pendingAction(
        target,
        command.type === "feedback" ? { ...command, feedback: command.feedback.trim() } : command,
      );
      persist(keys.operation, { signature: pending.signature, operationId: pending.operationId });
      await api.action(target.id, { ...pending.payload, operationId: pending.operationId });
      clearOperation(pending.operationId);
      if (command.type === "feedback") {
        const saved = savedFeedback();
        if (saved?.id === target.id && saved.text.trim() === command.feedback.trim())
          remove(keys.feedback);
      }
      if (active()) await reload();
    } catch (error) {
      if (active()) {
        if (error instanceof ApiError && error.status === 409) await reload();
        if (active()) setNotice(errorMessage(error));
      }
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  }
  return {
    route,
    id,
    run,
    missing,
    online,
    notice,
    setNotice,
    toast,
    setToast,
    submitting,
    recent,
    listError,
    refreshList,
    open,
    compose,
    library,
    create,
    action,
    archive,
    restore,
  };
}
