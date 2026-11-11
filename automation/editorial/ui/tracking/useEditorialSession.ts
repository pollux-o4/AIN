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
  currentId,
  keys,
  pendingAction,
  remove,
  savedFeedback,
  storageWarning,
  store,
} from "../shared/persistence";
import { isPending, useRunTracking } from "./useRunTracking";

const validId = (id: string | null): id is string => Boolean(id && /^[a-f0-9-]{36}$/.test(id));
function initialId() {
  const id = location.hash.slice(1) || currentId();
  return validId(id) ? id : null;
}
export function useEditorialSession() {
  const [id, setId] = useState(initialId);
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useState<RecentRun[]>([]);
  const [focusVersion, setFocusVersion] = useState(0);
  const busy = useRef(false);
  const selected = useRef(id);
  const navigation = useRef(0);
  const { run, online, reload } = useRunTracking(id, setNotice);
  const persist = useCallback((key: string, value: unknown) => {
    if (!store(key, value)) setNotice(storageWarning);
  }, []);
  const open = useCallback(
    (next: string) => {
      if (selected.current !== next) ++navigation.current;
      selected.current = next;
      persist(keys.current, next);
      setId(next);
      if (location.hash !== `#${next}`) location.hash = next;
    },
    [persist],
  );
  const compose = useCallback(() => {
    ++navigation.current;
    selected.current = null;
    setId(null);
    history.replaceState(null, "", location.pathname);
    remove(keys.current);
    remove(keys.create);
    setNotice("");
    setFocusVersion((value) => value + 1);
  }, []);
  useEffect(() => {
    if (selected.current) open(selected.current);
    function navigate() {
      const next = location.hash.slice(1);
      if (validId(next)) open(next);
      else compose();
    }
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
    // 최초 저장 경로 복구와 hashchange 구독은 한 번만 설정한다.
  }, [open, compose]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function list() {
      try {
        const data = await api.list();
        if (disposed) return;
        setRecent(data.runs);
        if (!id && data.runs.some((item) => isPending(item.status)))
          timer = setTimeout(() => void list(), 3000);
      } catch (error) {
        if (disposed) return;
        if (!id) setNotice(errorMessage(error));
        timer = setTimeout(() => void list(), 3000);
      }
    }
    if (!id) void list();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [id]);
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
  async function archive(target: RecentRun) {
    if (!window.confirm(`'${target.title}'을(를) 목록에서 삭제할까요?`)) return;
    try {
      await api.archive(target.id);
      setRecent((runs) => runs.filter((item) => item.id !== target.id));
      setNotice("");
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
    id,
    run,
    online,
    notice,
    setNotice,
    submitting,
    recent,
    focusVersion,
    open,
    compose,
    create,
    action,
    archive,
  };
}
