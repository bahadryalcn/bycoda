import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import { type Session } from "../../../features/sessions/model/session";
import { forgetHarnessSession } from "../../../integrations/harness";
import { isBlankSession } from "../../../features/projects/model/projectReturn";
import { looksLikeProject, sameProjectPath } from "../../../features/projects/model/recents";
import {
  focusedWorkspaceTabCwd,
  findOpenSessionTab,
} from "../../../features/workspace/model/workspaceTabGroups";
import {
  leafIds,
  replaceLeafId,
  selectPaneTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";

export interface OpenSessionTargetsDeps {
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: { current: Session[] };
  activeTabIdRef: MutableRefObject<string>;
  lastPersisted: MutableRefObject<Map<string, string>>;
  loadedSessionCache: MutableRefObject<Map<string, Session>>;
  setSessions: typeof setSessions;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setActiveTabId: (id: string) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  followProject: (cwd: string | null | undefined) => void;
}

/** Focuses an already-open session tab, or puts a session into a blank pane. */
export function useOpenSessionTargets({
  tabsRef,
  sessionsRef,
  activeTabIdRef,
  lastPersisted,
  loadedSessionCache,
  setSessions,
  setTabs,
  setActiveTabId,
  setComposerFocused,
  followProject,
}: OpenSessionTargetsDeps) {
  const focusOpenSession = useCallback(
    (sessionId: string) => {
      const tab = findOpenSessionTab(tabsRef.current, sessionsRef.current, sessionId);
      if (!tab) return false;
      loadedSessionCache.current.delete(sessionId);
      setActiveTabId(tab.id);
      setTabs((prev) =>
        prev.map((entry) =>
          entry.id === tab.id
            ? { ...entry, layout: selectPaneTab(entry.layout, sessionId), focusedId: sessionId }
            : entry,
        ),
      );
      followProject(
        focusedWorkspaceTabCwd(
          { ...tab, layout: selectPaneTab(tab.layout, sessionId), focusedId: sessionId },
          sessionsRef.current,
        ),
      );
      setComposerFocused(true);
      return true;
    },
    [followProject],
  );

  const replaceBlankPaneWithSession = useCallback((session: Session) => {
    const tab =
      tabsRef.current.find((entry) => entry.id === activeTabIdRef.current) ?? tabsRef.current[0];
    if (!tab) return false;

    const paneId = isBlankSession(sessionsRef.current.find((entry) => entry.id === tab.focusedId))
      ? tab.focusedId
      : leafIds(tab.layout).find((id) =>
          isBlankSession(sessionsRef.current.find((entry) => entry.id === id)),
        );
    if (!paneId || paneId === session.id) return false;
    // A blank pane belongs to its own project; a session from another one
    // gets its own tab in that project instead.
    const blankCwd = sessionsRef.current.find((entry) => entry.id === paneId)?.cwd;
    if (blankCwd && looksLikeProject(blankCwd) && !sameProjectPath(blankCwd, session.cwd))
      return false;

    lastPersisted.current.delete(paneId);
    {
      const blank = sessionsRef.current.find((entry) => entry.id === paneId);
      if (blank) void forgetHarnessSession(blank.harness, paneId);
    }
    setSessions((prev) => {
      const next = prev.filter((entry) => entry.id !== paneId);
      return next.some((entry) => entry.id === session.id) ? next : [...next, session];
    });
    setTabs((prev) =>
      prev.map((entry) =>
        entry.id === tab.id
          ? {
              ...entry,
              layout: replaceLeafId(entry.layout, paneId, session.id),
              focusedId: session.id,
            }
          : entry,
      ),
    );
    setActiveTabId(tab.id);
    setComposerFocused(true);
    return true;
  }, []);

  return { focusOpenSession, replaceBlankPaneWithSession };
}
