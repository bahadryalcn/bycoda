import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { message } from "@tauri-apps/plugin-dialog";
import type { setSessions } from "../../../features/sessions/model/sessionsStore";
import {
  newDefaultSession,
  sessionWorkCwd,
  type Session,
} from "../../../features/sessions/model/session";
import { getGroupLockView } from "../../../features/group-lock/model/groupLock";
import { isProjectLockedIn } from "../../../features/group-lock/model/lockState";
import { parseRemotePath } from "../../../features/connections/model/remoteProjects";
import { remoteSessionFor } from "../../../features/connections/model/connections";
import {
  remoteSessionOwnershipKey,
  reserveSessionWindow,
} from "../../model/sessionWindowOwnership";
import { appName } from "../../../shared/lib/appName";
import { forgetHarnessSession } from "../../../integrations/harness";
import { isBlankSession } from "../../../features/projects/model/projectReturn";
import {
  applyPlaceSessionOnPane,
  applyPlaceTabOnPane,
} from "../../../features/workspace/model/workspaceTabGroups";
import {
  leafIds,
  type PaneEdge,
  type PaneTabDropPosition,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { t } from "../../../shared/i18n";
import { filesInWorkspaceTabs } from "../helpers/tabHelpers";

type PlaceSessionArgs = Parameters<typeof applyPlaceSessionOnPane>[0];

export interface SessionPlacementDeps {
  isMovingPane: (paneId: string) => boolean;
  movingTabIds: MutableRefObject<Set<string>>;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: { current: Session[] };
  dirtyFilesRef: MutableRefObject<Set<string>>;
  lastPersisted: MutableRefObject<Map<string, string>>;
  projectCwdRef: MutableRefObject<string>;
  setSessions: typeof setSessions;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setActiveTabId: (id: string) => void;
  setProjectTerminalFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  ensureOpenSession: (sessionId: string) => Promise<Session | null>;
  tabCloseScope: PlaceSessionArgs["scope"];
  tabWorktreeOf: NonNullable<PlaceSessionArgs["worktreeOf"]>;
  onMovePane: (
    paneId: string,
    targetId: string,
    edge: PaneEdge,
    tabPosition?: PaneTabDropPosition,
  ) => void;
}

/** Drops a session or a whole tab onto another pane's edge. */
export function useSessionPlacement({
  isMovingPane,
  movingTabIds,
  tabsRef,
  sessionsRef,
  dirtyFilesRef,
  lastPersisted,
  projectCwdRef,
  setSessions,
  setTabs,
  setActiveTabId,
  setProjectTerminalFocused,
  setComposerFocused,
  ensureOpenSession,
  tabCloseScope,
  tabWorktreeOf,
  onMovePane,
}: SessionPlacementDeps) {
  const onPlaceSessionOnPane = useCallback(
    async (sessionId: string, targetId: string, edge: PaneEdge) => {
      if (isMovingPane(sessionId) || isMovingPane(targetId)) return;
      if (sessionId === targetId) return;
      const targetTab = tabsRef.current.find((tab) => leafIds(tab.layout).includes(targetId));
      if (!targetTab) return;
      const sourceTabId = tabsRef.current.find((tab) =>
        leafIds(tab.layout).includes(sessionId),
      )?.id;
      if (
        movingTabIds.current.has(targetTab.id) ||
        (sourceTabId && movingTabIds.current.has(sourceTabId))
      )
        return;

      const alreadyHere = leafIds(targetTab.layout).includes(sessionId);
      if (!alreadyHere) {
        const session = await ensureOpenSession(sessionId);
        if (!session) return;
      }

      const session = sessionsRef.current.find((entry) => entry.id === sessionId);
      if (!session || session.inboxAsk) return;
      const beforeTab = tabsRef.current.find((entry) => entry.id === targetTab.id);
      if (
        !beforeTab ||
        !leafIds(beforeTab.layout).includes(targetId) ||
        tabsRef.current.find((entry) => leafIds(entry.layout).includes(sessionId))?.id !==
          sourceTabId
      )
        return;
      const beforeLock = getGroupLockView().lock;
      const beforeTarget = sessionsRef.current.find((entry) => entry.id === targetId);
      if (
        isProjectLockedIn(beforeLock, session.cwd) ||
        isProjectLockedIn(beforeLock, sessionWorkCwd(session)) ||
        (beforeTarget &&
          (isProjectLockedIn(beforeLock, beforeTarget.cwd) ||
            isProjectLockedIn(beforeLock, sessionWorkCwd(beforeTarget))))
      )
        return;
      const beforeWorktree = tabWorktreeOf(beforeTab);
      if (beforeWorktree && isProjectLockedIn(beforeLock, beforeWorktree)) return;
      if (
        isMovingPane(sessionId) ||
        isMovingPane(targetId) ||
        movingTabIds.current.has(targetTab.id) ||
        (sourceTabId && movingTabIds.current.has(sourceTabId))
      )
        return;
      const remoteId = remoteSessionFor(session.id);
      const sourceCwd = session.cwd;
      const sourceWorktree = sessionWorkCwd(session);
      const remoteKey =
        remoteId && parseRemotePath(session.cwd)
          ? remoteSessionOwnershipKey(session.cwd, remoteId)
          : null;
      let release: Awaited<ReturnType<typeof reserveSessionWindow>>;
      try {
        release = await reserveSessionWindow(remoteKey ? [session.id, remoteKey] : [session.id]);
      } catch (error) {
        await message(String(error), { title: appName(), kind: "warning" });
        return;
      }
      if (!release) return;
      let retained = false;
      try {
        const current = sessionsRef.current.find((entry) => entry.id === sessionId);
        const currentRemoteId = current && remoteSessionFor(current.id);
        const currentRemoteKey =
          current && currentRemoteId && parseRemotePath(current.cwd)
            ? remoteSessionOwnershipKey(current.cwd, currentRemoteId)
            : null;
        const currentSourceTabId = tabsRef.current.find((entry) =>
          leafIds(entry.layout).includes(sessionId),
        )?.id;
        if (
          !current ||
          current.inboxAsk ||
          current.cwd !== sourceCwd ||
          sessionWorkCwd(current) !== sourceWorktree ||
          currentRemoteKey !== remoteKey ||
          currentSourceTabId !== sourceTabId ||
          isMovingPane(sessionId) ||
          isMovingPane(targetId) ||
          movingTabIds.current.has(targetTab.id) ||
          (sourceTabId && movingTabIds.current.has(sourceTabId))
        )
          return;
        const lock = getGroupLockView().lock;
        if (
          isProjectLockedIn(lock, current.cwd) ||
          isProjectLockedIn(lock, sessionWorkCwd(current))
        )
          return;

        const tab = tabsRef.current.find((entry) => entry.id === targetTab.id);
        if (!tab || !leafIds(tab.layout).includes(targetId)) return;
        const targetSession = sessionsRef.current.find((entry) => entry.id === targetId);
        if (
          targetSession &&
          (isProjectLockedIn(lock, targetSession.cwd) ||
            isProjectLockedIn(lock, sessionWorkCwd(targetSession)))
        )
          return;
        const targetWorktree = tabWorktreeOf(tab);
        if (targetWorktree && isProjectLockedIn(lock, targetWorktree)) return;

        const replaceTarget =
          !leafIds(tab.layout).includes(sessionId) &&
          isBlankSession(sessionsRef.current.find((entry) => entry.id === targetId));

        const result = applyPlaceSessionOnPane({
          tabs: tabsRef.current,
          sessions: sessionsRef.current,
          sessionId,
          targetId,
          edge,
          replaceTarget,
          scope: tabCloseScope,
          worktreeOf: tabWorktreeOf,
          createReplacement: (seed) =>
            newDefaultSession(seed?.cwd ?? projectCwdRef.current, seed?.runtimeMode),
        });
        if (!result) return;

        if (replaceTarget) {
          lastPersisted.current.delete(targetId);
          const blank = sessionsRef.current.find((entry) => entry.id === targetId);
          if (blank) void forgetHarnessSession(blank.harness, targetId).catch(console.warn);
        }

        sessionsRef.current = result.sessions;
        tabsRef.current = result.tabs;
        setSessions(result.sessions);
        setTabs(result.tabs);
        setActiveTabId(result.activeTabId);
        setProjectTerminalFocused(false);
        setComposerFocused(true);
        retained = true;
      } finally {
        await release(retained).catch((error) =>
          console.error("Conversation ownership release failed", error),
        );
      }
    },
    [ensureOpenSession, isMovingPane, tabCloseScope, tabWorktreeOf],
  );

  const onPlaceTabOnPane = useCallback(
    (sourceTabId: string, targetId: string, edge: PaneEdge, tabPosition?: PaneTabDropPosition) => {
      if (movingTabIds.current.has(sourceTabId) || isMovingPane(targetId)) return;
      const sourceTab = tabsRef.current.find((tab) => tab.id === sourceTabId);
      const targetTab = tabsRef.current.find((tab) => leafIds(tab.layout).includes(targetId));
      if (!targetTab) return;
      if (targetTab.id === sourceTabId) {
        if (targetTab.focusedId !== targetId || edge !== "center") {
          onMovePane(targetTab.focusedId, targetId, edge, tabPosition);
        }
        return;
      }

      if (
        sourceTab &&
        filesInWorkspaceTabs([sourceTab]).some((file) => dirtyFilesRef.current.has(file.id))
      ) {
        void message("Save the unsaved files before moving this tab to another workspace tab.", {
          get title() {
            return t("Arrange workspace");
          },
        });
        return;
      }
      const blankTarget = sessionsRef.current.find(
        (session) => session.id === targetId && isBlankSession(session),
      );
      const result = applyPlaceTabOnPane({
        tabs: tabsRef.current,
        sessions: sessionsRef.current,
        sourceTabId,
        targetId,
        edge,
        tabPosition,
        replaceTarget: blankTarget != null,
      });
      if (!result) return;

      if (blankTarget) {
        lastPersisted.current.delete(blankTarget.id);
        void forgetHarnessSession(blankTarget.harness, blankTarget.id).catch(console.warn);
      }
      sessionsRef.current = result.sessions;
      tabsRef.current = result.tabs;
      setSessions(result.sessions);
      setTabs(result.tabs);
      setActiveTabId(result.activeTabId);
      setProjectTerminalFocused(false);
      setComposerFocused(result.sessions.some((session) => session.id === result.focusedId));
    },
    [onMovePane],
  );

  return { onPlaceSessionOnPane, onPlaceTabOnPane };
}
