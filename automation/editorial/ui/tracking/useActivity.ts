import { useEffect, useState } from "react";
import type { z } from "zod";
import { activitySchema } from "../../../contracts/activity.mjs";
import { isPending } from "./useRunTracking";

export type Activity = z.infer<typeof activitySchema>;
export function useActivity(id: string, revision: number, status: string) {
  const [snapshot, setSnapshot] = useState<{ id: string; value: Activity } | null>(null);
  const [connection, setConnection] = useState("connecting");
  const pending = isPending(status);
  useEffect(() => {
    if (!pending) return;
    let disposed = false;
    setConnection("connecting");
    const source = new EventSource(`/write/api/runs/${id}/activity`);
    source.onopen = () => {
      if (!disposed) setConnection("connected");
    };
    source.onerror = () => {
      if (!disposed) setConnection("reconnecting");
    };
    const receive = (event: MessageEvent<string>) => {
      if (disposed) return;
      try {
        const value = activitySchema.parse(JSON.parse(event.data));
        if (value.revision !== revision) return;
        setSnapshot((previous) => {
          const retain =
            value.phase === "unavailable" &&
            !value.text &&
            previous?.id === id &&
            previous.value.revision === revision &&
            previous.value.stage === value.stage;
          return {
            id,
            value: retain
              ? {
                  ...value,
                  text: previous.value.text,
                  lastOutputAt: previous.value.lastOutputAt,
                  truncated: previous.value.truncated,
                }
              : value,
          };
        });
        setConnection("connected");
        if (!value.active) source.close();
      } catch {
        setConnection("reconnecting");
      }
    };
    source.addEventListener("activity", receive);
    return () => {
      disposed = true;
      source.close();
    };
  }, [id, revision, pending]);
  const activity =
    snapshot?.id === id && snapshot.value.revision === revision ? snapshot.value : null;
  return { activity, connection: pending ? connection : "finished" };
}
