import { type Session } from "../../../features/sessions/model/session";
import { type MutableRefObject, useEffect, useSyncExternalStore } from "react";
import { type Submit } from "../helpers/types";
import { CONTINUE_PROMPT, canAutoContinue } from "../../../features/sessions/model/inFlight";
import { isLiveHarness } from "../../../integrations/harness";
import {
  autoContinueVersion,
  claimAutoContinue,
  isAutoContinueDue,
  subscribeAutoContinue,
} from "../../../features/sessions/model/autoContinue";
export interface AutoContinueDeps {
  sessions: Session[];
  sessionsRef: MutableRefObject<Session[]>;
  windowTransferPending: boolean;
  windowTransferPendingRef: MutableRefObject<boolean>;
  movingSessionIds: MutableRefObject<Set<string>>;
  onSubmit: (...args: Parameters<Submit>) => unknown;
}

/** Schedules the auto-continue prompt for sessions that are due and claimable. */
export function useAutoContinue({
  sessions,
  sessionsRef,
  windowTransferPending,
  windowTransferPendingRef,
  movingSessionIds,
  onSubmit,
}: AutoContinueDeps): void {
  // The launch check can finish after first paint while the Host starts.
  useSyncExternalStore(subscribeAutoContinue, autoContinueVersion);
  const autoContinueKey = sessions
    .filter(
      (session) =>
        !windowTransferPending &&
        !movingSessionIds.current.has(session.id) &&
        canAutoContinue(session) &&
        isLiveHarness(session.harness) &&
        isAutoContinueDue(session.id),
    )
    .map((session) => session.id)
    .join("\n");

  useEffect(() => {
    if (!autoContinueKey) return;
    const ids = autoContinueKey.split("\n");
    // Delay past React StrictMode's dev remount so Continue is not claimed
    // against a discarded tree (sessionStorage also survives Vite reloads).
    const timer = window.setTimeout(() => {
      for (const id of ids) {
        const session = sessionsRef.current.find((entry) => entry.id === id);
        if (
          !session ||
          windowTransferPendingRef.current ||
          movingSessionIds.current.has(id) ||
          !canAutoContinue(session) ||
          !isLiveHarness(session.harness) ||
          !claimAutoContinue(id)
        ) {
          continue;
        }
        onSubmit(id, CONTINUE_PROMPT);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoContinueKey, onSubmit, windowTransferPendingRef, sessionsRef, movingSessionIds]);
}
