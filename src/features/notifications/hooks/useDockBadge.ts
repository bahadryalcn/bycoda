import { useEffect } from "react";
import { getShellSessions, subscribeShell } from "../../sessions/model/sessionsStore";
import { syncDockBadge } from "../model/dockBadge";

/** Native badge follows input/status changes without depending on shell renders. */
export function useDockBadge(): void {
  useEffect(() => {
    const sync = () => syncDockBadge(getShellSessions());
    const unsubscribe = subscribeShell(sync);
    sync();
    return unsubscribe;
  }, []);
}
