import { message } from "@tauri-apps/plugin-dialog";
import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { confirmSessionDelete } from "../../../features/sessions/model/confirmSessionDelete";
import { createSessionRemover } from "../../../features/sessions/model/sessionRemoval";
import {
  dismissSessionDeletionStatus,
  setSessionDeletionStatus,
  type SessionDeletionStatus,
  type SessionDeletionStage,
} from "../../../features/sessions/model/sessionDeletionStatus";
import { type SessionDeleteChoice } from "../../../features/sessions/ui/DeleteSessionDialog";
import { type Session, sessionDisplayTitle } from "../../../features/sessions/model/session";
import { rememberLoadedSession } from "../../../features/sessions/data/sessionCache";
import {
  mergeHistorySummary,
  summaryFromSession,
} from "../../../features/sessions/data/sessionHistory";
import {
  shouldPersistSession,
  type SessionSummary,
} from "../../../features/sessions/data/sessionStore";
import { releaseOrchestrationWorker } from "../../../features/orchestration/model/orchestrationWorkspace";
import { isRemoteProjectPath, sameProjectPath } from "../../../features/projects/model/recents";
import {
  listWorktrees,
  worktreeSessionIds,
} from "../../../features/source-control/model/worktrees";
import { worktreeFocus } from "../../../features/source-control/model/worktreeFocus";
import { confirmCloseTerminals } from "../../../features/terminal/model/terminalClose";
import {
  isFilesystemTab,
  leafIds,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { appName } from "../../../shared/lib/appName";
import { pathKey } from "../../../shared/lib/paths";
import { confirmDiscardUnsaved } from "../helpers/appHelpers";
import { filesInWorkspaceTabs } from "../helpers/tabHelpers";
import type { useSessionLoading } from "./useSessionLoading";
import type { useTabActivation } from "../tabs/useTabActivation";
import type { useWorktreeRemoval } from "../projects/useWorktreeRemoval";

export interface HistorySessionDeleteDeps {
  sessions: {
    sessionsRef: MutableRefObject<Session[]>;
    setSessions: Dispatch<SetStateAction<Session[]>>;
    history: SessionSummary[];
    setHistory: Dispatch<SetStateAction<SessionSummary[]>>;
    setStoredLinkedSessions: Dispatch<SetStateAction<SessionSummary[]>>;
    loadedSessionCache: MutableRefObject<Map<string, Session>>;
    sessionLoads: MutableRefObject<Map<string, Promise<Session | null>>>;
    lastPersisted: MutableRefObject<Map<string, string>>;
    pendingPersist: MutableRefObject<Map<string, Session>>;
    invalidateLoadedSession: ReturnType<typeof useSessionLoading>["invalidateLoadedSession"];
    refreshHistory: (cwd: string) => Promise<unknown>;
    sidebarCwd: string;
  };
  tabs: {
    tabsRef: MutableRefObject<WorkspaceTab[]>;
    activeTabIdRef: MutableRefObject<string>;
    dirtyFilesRef: MutableRefObject<Set<string>>;
    setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
    setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
    setComposerFocused: Dispatch<SetStateAction<boolean>>;
    activateTab: ReturnType<typeof useTabActivation>["activateTab"];
    tabWorkspace: (tab: WorkspaceTab, list: readonly Session[]) => string | null | undefined;
    tabWorktreeOf: (tab: WorkspaceTab) => string | null;
    tabCloseScope: "project";
  };
  removal: {
    removingSessionIds: MutableRefObject<Set<string>>;
    switchingWorktrees: MutableRefObject<Map<string, string>>;
    deleteConfirmationPending: MutableRefObject<boolean>;
    setSessionDeleteDialog: Dispatch<
      SetStateAction<
        | {
            title: string;
            unusedWorktree: string;
            resolve: (choice: SessionDeleteChoice) => void;
          }
        | undefined
      >
    >;
    stopSessionForRemoval: (sessionId: string) => Promise<Session | undefined>;
    onRemoveWorktree: ReturnType<typeof useWorktreeRemoval>["onRemoveWorktree"];
  };
}

export function useHistorySessionDelete(deps: HistorySessionDeleteDeps) {
  const {
    sessionsRef,
    setSessions,
    history,
    setHistory,
    setStoredLinkedSessions,
    loadedSessionCache,
    sessionLoads,
    lastPersisted,
    pendingPersist,
    invalidateLoadedSession,
    refreshHistory,
    sidebarCwd,
  } = deps.sessions;
  const {
    tabsRef,
    activeTabIdRef,
    dirtyFilesRef,
    setTabs,
    setDirtyFiles,
    setComposerFocused,
    activateTab,
    tabWorkspace,
    tabWorktreeOf,
    tabCloseScope,
  } = deps.tabs;
  const {
    removingSessionIds,
    switchingWorktrees,
    deleteConfirmationPending: deleteConfirmationPendingRef,
    setSessionDeleteDialog,
    stopSessionForRemoval,
    onRemoveWorktree,
  } = deps.removal;

  const onRemoveHistorySession = useCallback(
    async (
      sessionId: string,
      mode: "archive" | "delete",
      skipDeleteConfirm = false,
      // A bulk caller collects errors itself instead of one dialog each.
      onError?: (detail: string) => void,
    ): Promise<boolean> => {
      if (
        removingSessionIds.current.has(sessionId) ||
        switchingWorktrees.current.has(sessionId) ||
        deleteConfirmationPendingRef.current
      )
        return false;
      const open = sessionsRef.current.find((session) => session.id === sessionId);
      const summary = history.find((entry) => entry.id === sessionId);
      const seed = open ?? summary;
      const label = seed ? sessionDisplayTitle(seed.title, seed.harness) : "this session";
      removingSessionIds.current.add(sessionId);
      let deletionStatus: SessionDeletionStatus | undefined =
        mode === "delete"
          ? {
              sessionId,
              cwd: seed?.cwd ?? sidebarCwd,
              title: label,
              stage: "preparing",
              startedAt: Date.now(),
            }
          : undefined;
      const progress = (stage: SessionDeletionStage) => {
        if (!deletionStatus) return;
        deletionStatus = { ...deletionStatus, stage };
        setSessionDeletionStatus(deletionStatus);
      };
      progress("preparing");
      let deleteWorktreePath: string | undefined;
      let ownsDeleteConfirmation = false;
      try {
        if (mode === "delete" && !skipDeleteConfirm) {
          deleteConfirmationPendingRef.current = true;
          ownsDeleteConfirmation = true;
          let unusedWorktree: string | undefined;
          if (seed?.worktreeCwd) {
            try {
              const { worktrees } = await listWorktrees(seed.cwd);
              const tree = worktrees.find(
                (entry) => pathKey(entry.path) === pathKey(seed.worktreeCwd!),
              );
              if (
                tree &&
                !tree.isMain &&
                !tree.locked &&
                tree.branch &&
                worktreeSessionIds(tree, sessionsRef.current).every((id) => id === sessionId)
              )
                unusedWorktree = tree.path;
            } catch {
              // A failed lookup must never offer filesystem cleanup.
            }
          }
          if (!unusedWorktree) {
            deleteConfirmationPendingRef.current = false;
            ownsDeleteConfirmation = false;
          } else {
            const choice = await new Promise<SessionDeleteChoice>((resolve) => {
              setSessionDeleteDialog({ title: label, unusedWorktree, resolve });
            });
            deleteConfirmationPendingRef.current = false;
            ownsDeleteConfirmation = false;
            if (!choice.confirmed) {
              removingSessionIds.current.delete(sessionId);
              return false;
            }
            if (choice.deleteWorktree) deleteWorktreePath = unusedWorktree;
          }
        }
        invalidateLoadedSession(sessionId);
        pendingPersist.current.delete(sessionId);
        const remover = createSessionRemover({
          mode,
          onProgress: progress,
          scope: tabCloseScope,
          worktreeOf: tabWorktreeOf,
          // The blank replacement stays in the tab's worktree, unless that
          // worktree is being deleted along with the session.
          worktreeFor: (removed) => {
            const tab = tabsRef.current.find((entry) => leafIds(entry.layout).includes(removed.id));
            const workspace = tab && tabWorkspace(tab, sessionsRef.current);
            if (
              !workspace ||
              isRemoteProjectPath(removed.cwd) ||
              sameProjectPath(workspace, removed.cwd) ||
              (deleteWorktreePath && sameProjectPath(workspace, deleteWorktreePath))
            )
              return undefined;
            const focus = worktreeFocus(removed.cwd);
            return {
              worktreeCwd: workspace,
              branch:
                (focus && sameProjectPath(focus.path, workspace) ? focus.branch : undefined) ??
                (removed.worktreeCwd && sameProjectPath(removed.worktreeCwd, workspace)
                  ? removed.branch
                  : undefined) ??
                undefined,
            };
          },
          replacement: {
            harness: seed?.harness ?? "cursor",
            cwd: seed?.cwd ?? sidebarCwd,
            model: seed?.model,
            runtimeMode: seed?.runtimeMode,
            modelSettings: open?.modelSettings,
          },
          workspace: {
            snapshot: () => ({
              tabs: tabsRef.current,
              sessions: sessionsRef.current,
              activeTabId: activeTabIdRef.current,
              dirtyFiles: dirtyFilesRef.current,
            }),
            apply: (change) => {
              if (change.type === "stopped") {
                const next = sessionsRef.current.map((session) =>
                  session.id === sessionId ? change.session : session,
                );
                sessionsRef.current = next;
                setSessions(next);
                return;
              }

              if (change.type === "orchestrationReleased") {
                const released = sessionsRef.current.map((session) =>
                  releaseOrchestrationWorker(session, change.leadId),
                );
                sessionsRef.current = released;
                setSessions(released);
                for (const [id, cached] of loadedSessionCache.current) {
                  if (releaseOrchestrationWorker(cached, change.leadId) !== cached)
                    invalidateLoadedSession(id);
                }
                // Pending reads may still carry the deleted lead's ownership.
                for (const id of sessionLoads.current.keys()) {
                  invalidateLoadedSession(id);
                }
                for (const [id, pending] of pendingPersist.current) {
                  pendingPersist.current.set(
                    id,
                    releaseOrchestrationWorker(pending, change.leadId),
                  );
                }
                const releaseSummary = (entry: SessionSummary) =>
                  entry.orchestrationLeadId === change.leadId
                    ? { ...entry, orchestrationLeadId: undefined }
                    : entry;
                setHistory((current) => current.map(releaseSummary));
                setStoredLinkedSessions((current) => current.map(releaseSummary));
                return;
              }

              const { removal } = change;
              lastPersisted.current.delete(sessionId);
              pendingPersist.current.delete(sessionId);
              const closingFiles = filesInWorkspaceTabs(removal.closedTabs);
              setDirtyFiles((current) => {
                const next = new Set(current);
                for (const file of closingFiles) next.delete(file.id);
                return next;
              });
              sessionsRef.current = removal.sessions;
              tabsRef.current = removal.tabs;
              setSessions(removal.sessions);
              setTabs(removal.tabs);
              if (removal.activeTabId !== activeTabIdRef.current) {
                activateTab(removal.activeTabId);
              }
              const activeTab = removal.tabs.find((tab) => tab.id === removal.activeTabId);
              setComposerFocused(
                removal.sessions.some((session) => session.id === activeTab?.focusedId),
              );
              if (change.mode === "archive") {
                if (change.session && shouldPersistSession(change.session)) {
                  rememberLoadedSession(loadedSessionCache.current, change.session);
                }
                const archived =
                  change.savedSummary ??
                  summary ??
                  (change.session && summaryFromSession(change.session));
                if (archived) {
                  setHistory((current) =>
                    mergeHistorySummary(current, {
                      ...archived,
                      archived: true,
                    }),
                  );
                }
              } else {
                setHistory((current) => current.filter((entry) => entry.id !== sessionId));
                void refreshHistory(sidebarCwd);
              }
            },
          },
          confirm: async (closedTabs, removalMode) => {
            const files = filesInWorkspaceTabs(closedTabs);
            const unsaved = files.some(
              (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
            );
            if (
              unsaved &&
              !(await confirmDiscardUnsaved(
                `${removalMode === "archive" ? "Archive" : "Delete"} this conversation with unsaved files?`,
              ))
            )
              return false;
            const terminals = files.filter((file) => file.terminal);
            return terminals.length === 0 || (await confirmCloseTerminals(terminals));
          },
          stop: stopSessionForRemoval,
        });
        const removed = await remover.remove(sessionId);
        let worktreeError: string | undefined;
        if (removed && deleteWorktreePath && seed) {
          progress("worktree");
          try {
            await onRemoveWorktree(seed.cwd, deleteWorktreePath, false);
          } catch (error) {
            worktreeError = String(error);
            void message(
              `The session was deleted. Its worktree was kept.\n\n${String(error)}\n\nYou can manage it in Settings → Worktrees.`,
              { title: appName(), kind: "warning" },
            );
          }
        }
        if (removed && deletionStatus) {
          deletionStatus = { ...deletionStatus, outcome: "deleted", error: worktreeError };
          setSessionDeletionStatus(deletionStatus);
        }
        return removed;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (deletionStatus) {
          deletionStatus = { ...deletionStatus, outcome: "failed", error: detail };
          setSessionDeletionStatus(deletionStatus);
        }
        if (onError) {
          onError(detail);
          return false;
        }
        void message(`Could not ${mode} this conversation.\n\n${detail}`, {
          title: appName(),
          kind: "error",
        });
        return false;
      } finally {
        if (ownsDeleteConfirmation) deleteConfirmationPendingRef.current = false;
        if (deletionStatus && !deletionStatus.outcome) dismissSessionDeletionStatus(sessionId);
        removingSessionIds.current.delete(sessionId);
      }
    },
    [
      activateTab,
      history,
      invalidateLoadedSession,
      refreshHistory,
      sidebarCwd,
      stopSessionForRemoval,
      tabCloseScope,
      onRemoveWorktree,
    ],
  );

  const onDeleteWorktreeSessions = useCallback(
    async (sessionIds: readonly string[]): Promise<boolean> => {
      for (const sessionId of sessionIds) {
        if (!(await onRemoveHistorySession(sessionId, "delete", true))) {
          return false;
        }
      }
      return true;
    },
    [onRemoveHistorySession],
  );

  const onDeleteHistorySession = useCallback(
    (sessionId: string) => onRemoveHistorySession(sessionId, "delete"),
    [onRemoveHistorySession],
  );

  const onDeleteHistorySessions = useCallback(
    async (sessionIds: readonly string[]) => {
      if (sessionIds.length === 0) return;
      if (
        !(await confirmSessionDelete(
          `Delete ${sessionIds.length} selected conversations? This can’t be undone.`,
        ))
      )
        return;
      for (const sessionId of sessionIds) {
        if (!(await onRemoveHistorySession(sessionId, "delete", true))) break;
      }
    },
    [onRemoveHistorySession],
  );

  const onDeleteHistorySessionNow = useCallback(
    async (sessionId: string, skipWorktreeConfirm = true): Promise<boolean> => {
      const failures: string[] = [];
      const removed = await onRemoveHistorySession(
        sessionId,
        "delete",
        skipWorktreeConfirm,
        (detail) => failures.push(detail),
      );
      if (failures.length > 0) throw new Error(failures[0]);
      return removed;
    },
    [onRemoveHistorySession],
  );

  return {
    onRemoveHistorySession,
    onDeleteWorktreeSessions,
    onDeleteHistorySession,
    onDeleteHistorySessions,
    onDeleteHistorySessionNow,
  };
}
