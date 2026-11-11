import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { listAutomations } from "../../../features/automations/model/automations";
import { loadNoteSummaries } from "../../../features/notes";
import type { Session } from "../../../features/sessions/model/session";
import { stopHarnessTextPrompts } from "../../../integrations/harness";
import { preloadNavigationWhenIdle } from "../../model/preloadNavigation";
import {
  AutomationsView,
  InboxView,
  LinkedWorkItemPanel,
  NotesView,
  TasksView,
} from "../surfaces/lazySurfaces";

export interface SessionHousekeepingDeps {
  sessions: Session[];
  btwRequestsRef: MutableRefObject<Map<string, { sessionId: string; controller: AbortController }>>;
  notesEnabled: boolean;
  notesViewOpen: boolean;
  setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
}

/**
 * Btw request pruning and unmount cleanup, notes-panel gating (render-time) and idle
 * surface preloads. The effects keep their original order; they run where the first was declared.
 */
export function useSessionHousekeeping({
  sessions,
  btwRequestsRef,
  notesEnabled,
  notesViewOpen,
  setNotesViewOpen,
}: SessionHousekeepingDeps): void {
  // The notes view cannot stay open once notes are disabled. Adjusted while
  // rendering so no frame shows a disabled panel; nothing is persisted for it.
  if (!notesEnabled && notesViewOpen) setNotesViewOpen(false);

  useEffect(() => {
    const liveSessionIds = new Set(sessions.map((session) => session.id));
    for (const [key, request] of btwRequestsRef.current) {
      if (liveSessionIds.has(request.sessionId)) continue;
      request.controller.abort();
      btwRequestsRef.current.delete(key);
    }
  }, [sessions, btwRequestsRef]);

  useEffect(
    () => () => {
      for (const request of btwRequestsRef.current.values()) {
        request.controller.abort();
      }
      btwRequestsRef.current.clear();
      void stopHarnessTextPrompts().catch((error) =>
        console.warn("Stopping text prompts failed", error),
      );
    },
    [btwRequestsRef],
  );

  useEffect(
    () =>
      preloadNavigationWhenIdle([
        InboxView.preload,
        LinkedWorkItemPanel.preload,
        AutomationsView.preload,
        TasksView.preload,
        listAutomations,
        ...(notesEnabled ? [NotesView.preload, loadNoteSummaries] : []),
      ]),
    [notesEnabled],
  );
}
