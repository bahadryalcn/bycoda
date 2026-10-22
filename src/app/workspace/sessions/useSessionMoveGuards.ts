import { useCallback, useRef, type MutableRefObject } from "react";
import { leafIds, type WorkspaceTab } from "../../../features/workspace/model/layout";
import { orchestrator } from "../../../features/orchestration/model/orchestration";
import { sessionChildHarnesses } from "../../../features/sessions/model/handoff";
import { cancelHarnessTurn } from "../../../integrations/harness";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";
import type { Session } from "../../../features/sessions/model/session";

export interface SessionMoveGuardDeps {
  windowTransferPendingRef: MutableRefObject<boolean>;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
}

// Sessions and tabs that are mid-move between windows or panes. Single instance
// per Workspace; the move flows read and write these sets directly.
export function useSessionMoveGuards({ windowTransferPendingRef, tabsRef }: SessionMoveGuardDeps) {
  const skipForgetSessionIds = useRef(new Set<string>());
  const movingTabIds = useRef(new Set<string>());
  const movingSessionIds = useRef(new Set<string>());
  const isMovingPane = useCallback(
    (paneId: string) =>
      windowTransferPendingRef.current ||
      tabsRef.current.some(
        (tab) => movingTabIds.current.has(tab.id) && leafIds(tab.layout).includes(paneId),
      ),
    [],
  );

  return { skipForgetSessionIds, movingTabIds, movingSessionIds, isMovingPane };
}

export interface StopSessionForRemovalDeps {
  turnGen: MutableRefObject<Map<string, number>>;
  flushHarnessEvents: () => void;
}

export function useStopSessionForRemoval({
  turnGen,
  flushHarnessEvents,
}: StopSessionForRemovalDeps): (sessionId: string) => Promise<Session | undefined> {
  const stopSessionForRemoval = useCallback(
    async (sessionId: string): Promise<Session | undefined> => {
      await orchestrator.stopForSession(sessionId);
      const open = sessionsRef.current.find((session) => session.id === sessionId);
      if (!open?.busy) return open;

      turnGen.current.set(sessionId, (turnGen.current.get(sessionId) ?? 0) + 1);
      flushHarnessEvents();
      await Promise.all(
        sessionChildHarnesses(open).map((harness) =>
          cancelHarnessTurn(harness, sessionId).catch((error) => {
            console.warn("App operation failed", error);
          }),
        ),
      );
      flushHarnessEvents();
      return sessionsRef.current.find((session) => session.id === sessionId);
    },
    [flushHarnessEvents],
  );

  return stopSessionForRemoval;
}
