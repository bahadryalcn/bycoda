import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { orchestrator } from "../../../features/orchestration/model/orchestration";
import { type Session } from "../../../features/sessions/model/session";
import { type LinkedSessionUpdate } from "../../../features/inbox/model/linkedSessionUpdates";
import {
  newTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import {
  planOpenSessionsSideBySide,
  SIDE_BY_SIDE_LIMIT,
} from "../../../features/workspace/model/workspaceTabGroups";

export interface OpenSessionActionsDeps {
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setActiveTabId: (id: string) => void;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setInspectedWorkerId: Dispatch<SetStateAction<string | null>>;
  followProject: (cwd: string | null | undefined) => void;
  appendTab: (tab: WorkspaceTab, cwd?: string) => void;
  insertBesideActive: (prev: WorkspaceTab[], tab: WorkspaceTab, cwd?: string) => WorkspaceTab[];
  ensureOpenSession: (sessionId: string) => Promise<Session | null>;
  focusOpenSession: (sessionId: string) => boolean;
  replaceBlankPaneWithSession: (session: Session) => boolean;
  linkedSessionUpdatesRef: MutableRefObject<ReadonlyMap<string, LinkedSessionUpdate>>;
  revealLinkedSessionUpdate: (sessionId: string, update: LinkedSessionUpdate) => void;
  orchestrator: typeof orchestrator;
  workspaceNavigation: { cancel: () => void };
}

/** Opens a history session in the workspace, or several side by side in one tab. */
export function useOpenSessionActions({
  tabsRef,
  setTabs,
  setActiveTabId,
  setProjectTerminalFocused,
  setComposerFocused,
  setInspectedWorkerId,
  followProject,
  appendTab,
  insertBesideActive,
  ensureOpenSession,
  focusOpenSession,
  replaceBlankPaneWithSession,
  linkedSessionUpdatesRef,
  revealLinkedSessionUpdate,
  orchestrator,
  workspaceNavigation,
}: OpenSessionActionsDeps) {
  const onSelectHistorySession = useCallback(
    async (sessionId: string) => {
      workspaceNavigation.cancel();
      let session = await ensureOpenSession(sessionId);
      if (!session || session.inboxAsk) return;
      const parentId = session.orchestrationLeadId ?? orchestrator.forSession(sessionId)?.leadId;
      if (parentId && parentId !== sessionId) {
        setInspectedWorkerId(sessionId);
        session = await ensureOpenSession(parentId);
        if (!session) return;
      }
      const linkedUpdate = linkedSessionUpdatesRef.current.get(session.id);
      if (focusOpenSession(session.id)) {
        if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
        return;
      }
      if (replaceBlankPaneWithSession(session)) {
        followProject(session.cwd);
        if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
        return;
      }
      const tab = newTab(session.id);
      appendTab(tab, session.cwd);
      setActiveTabId(tab.id);
      followProject(session.cwd);
      setComposerFocused(true);
      if (linkedUpdate) revealLinkedSessionUpdate(session.id, linkedUpdate);
    },
    [
      appendTab,
      ensureOpenSession,
      focusOpenSession,
      followProject,
      replaceBlankPaneWithSession,
      revealLinkedSessionUpdate,
    ],
  );

  /** Open several history sessions together as a grid in one new tab. */
  const onOpenSessionsSideBySide = useCallback(
    async (sessionIds: string[]) => {
      const wanted = [...new Set(sessionIds)].slice(0, SIDE_BY_SIDE_LIMIT);
      if (wanted.length === 0) return;
      workspaceNavigation.cancel();
      const loaded = await Promise.all(wanted.map((id) => ensureOpenSession(id)));
      const opened = loaded.filter((session): session is Session => !!session && !session.inboxAsk);
      if (opened.length === 0) return;
      if (opened.length === 1) {
        await onSelectHistorySession(opened[0].id);
        return;
      }
      const plan = planOpenSessionsSideBySide({
        tabs: tabsRef.current,
        sessionIds: opened.map((session) => session.id),
      });
      if (!plan) return;
      const cwd = opened[0].cwd;
      const next = insertBesideActive(plan.tabs, plan.tab, cwd);
      tabsRef.current = next;
      setTabs(next);
      setActiveTabId(plan.tab.id);
      setProjectTerminalFocused(false);
      followProject(cwd);
      setComposerFocused(true);
    },
    [ensureOpenSession, followProject, insertBesideActive, onSelectHistorySession],
  );

  return { onSelectHistorySession, onOpenSessionsSideBySide };
}
