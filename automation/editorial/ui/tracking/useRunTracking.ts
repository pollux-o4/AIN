import { useCallback, useEffect, useRef, useState } from "react";
import { isPendingStatus } from "../../../contracts/status.mjs";
import { ApiError, api, type Run } from "../shared/api";
import { reconcileOperation } from "../shared/persistence";

export const isPending = (status: string) => isPendingStatus(status);
export function useRunTracking(id: string | null, onNotice: (message: string) => void) {
  const [run, setRun] = useState<Run | null>(null);
  const [online, setOnline] = useState(true);
  const [missing, setMissing] = useState<string | null>(null);
  const refresh = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    setRun(null);
    setOnline(true);
    setMissing(null);
    if (!id) {
      refresh.current = async () => {};
      return;
    }
    const targetId = id;
    let disposed = false;
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      clearTimeout(timer);
      const request = ++sequence;
      let retry = false;
      try {
        const next = await api.load(targetId);
        if (disposed || request !== sequence) return;
        reconcileOperation(next);
        setRun(next);
        setOnline(true);
        onNotice("");
        retry = isPending(next.status);
      } catch (error) {
        if (disposed || request !== sequence) return;
        // 없는 작업은 재시도하지 않고 화면에 '찾을 수 없음'을 보인다.
        if (error instanceof ApiError && error.status === 404) {
          setMissing(targetId);
          return;
        }
        setOnline(false);
        onNotice("상태를 확인할 수 없습니다. 연결되면 다시 확인합니다.");
        retry = true;
      }
      if (!disposed && request === sequence && retry) timer = setTimeout(() => void load(), 1500);
    }
    refresh.current = load;
    void load();
    return () => {
      disposed = true;
      ++sequence;
      clearTimeout(timer);
    };
  }, [id, onNotice]);
  const reload = useCallback(() => refresh.current(), []);
  // 새 경로가 렌더된 직후에도 이전 글의 응답을 표시하지 않는다.
  return { run: run?.id === id ? run : null, online, reload, missing: missing === id };
}
