import { useLayoutEffect, useRef } from "react";
import type { Session } from "../../features/sessions/model/session";
import { resetSessionsStore } from "../../features/sessions/model/sessionsStore";

/** Initialize committed workspace state once, including StrictMode's effect replay. */
export function useInitializeSessions(initial: Session[]) {
  const initialized = useRef(false);
  useLayoutEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    resetSessionsStore(initial);
  }, [initial]);
}
