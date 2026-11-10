import { useEffect } from "react";
import { getShellSessions, subscribeShell } from "../../sessions/model/sessionsStore";
import { subscribeAttentionRules } from "../model/attentionRules";
import { syncDockBadge } from "../model/dockBadge";

/** Native badge follows input/status changes without depending on shell renders. */
export function useDockBadge(): void {
  useEffect(() => {
    const sync = () => syncDockBadge(getShellSessions());
    const unsubscribe = [subscribeShell(sync), subscribeAttentionRules(sync)];
    sync();
    return () => unsubscribe.forEach((off) => off());
  }, []);
}
