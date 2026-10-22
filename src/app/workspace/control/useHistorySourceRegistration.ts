import { useEffect, useRef, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getGroupLockView, subscribeGroupLock } from "../../../features/group-lock/model/groupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import { sessionWorkCwd, type Session } from "../../../features/sessions/model/session";
import { useSessionsSelector } from "../../../features/sessions/model/sessionsStore";

export function historySourceProjection(sessions: Session[], locked: (cwd: string) => boolean) {
  return sessions
    .filter(
      (source) =>
        !source.inboxAsk &&
        !source.orchestrationLeadId &&
        !source.cwd.startsWith("remote://") &&
        source.id.length <= 200 &&
        !locked(source.cwd) &&
        !locked(sessionWorkCwd(source)),
    )
    .slice(0, 1000)
    .map((source) => ({ sessionId: source.id, cwd: sessionWorkCwd(source) }));
}
/** Advertises open idle sources separately from active-turn grants; no provider or operator permission. */
export function useHistorySourceRegistration() {
  const queued = useRef(Promise.resolve());
  const lock = useSyncExternalStore(subscribeGroupLock, getGroupLockView).lock;
  const projection = useSessionsSelector((sessions) =>
    JSON.stringify(historySourceProjection(sessions, (cwd) => isProjectLockedIn(lock, cwd))),
  );
  useEffect(() => {
    let disposed = false;
    const publish = (sources: unknown[]) => {
      queued.current = queued.current
        .catch(() => undefined)
        .then(async () => {
          await invoke("control_history_sources", { sources });
        });
      void queued.current.catch(() => undefined);
    };
    const sources = JSON.parse(projection) as { sessionId: string; cwd: string }[];
    publish(sources);
    const timer = window.setInterval(() => {
      if (!disposed) publish(sources);
    }, 15000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      publish([]);
    };
  }, [projection]);
}
