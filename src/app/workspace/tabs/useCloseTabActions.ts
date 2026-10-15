import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { confirmCloseTerminals } from "../../../features/terminal/model/terminalClose";
import {
  isFilesystemTab,
  leafIds,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import {
  planWorkspaceTabClose,
  type WorkspaceTabCloseScope,
} from "../../../features/workspace/model/workspaceTabGroups";
import { type Session } from "../../../features/sessions/model/session";
import { confirmWorkspaceClose } from "../../model/closeConfirmation";
import { confirmDiscardUnsaved } from "../helpers/appHelpers";
import type { useTabActivation } from "./useTabActivation";

export interface CloseTabActionDeps {
  activateTab: ReturnType<typeof useTabActivation>["activateTab"];
  persistSession: (session: Session | undefined) => void;
  refreshHistory: (cwd: string) => Promise<unknown>;
  sidebarCwd: string;
  tabCloseScope: WorkspaceTabCloseScope;
  tabWorktreeOf: (tab: WorkspaceTab) => string | null;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  activeTabIdRef: MutableRefObject<string>;
  movingTabIds: MutableRefObject<Set<string>>;
  windowTransferPendingRef: MutableRefObject<boolean>;
  dirtyFilesRef: MutableRefObject<Set<string>>;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  rememberRemoteSession: (sessionId: string) => void;
  rememberRemotePendingWorktree: (sessionId: string) => void;
}

/** Close single tabs and batches of tabs, confirming unsaved files and terminals first. */
export function useCloseTabActions({
  activateTab,
  persistSession,
  refreshHistory,
  sidebarCwd,
  tabCloseScope,
  tabWorktreeOf,
  tabsRef,
  sessionsRef,
  activeTabIdRef,
  movingTabIds,
  windowTransferPendingRef,
  dirtyFilesRef,
  setDirtyFiles,
  setTabs,
  rememberRemoteSession,
  rememberRemotePendingWorktree,
}: CloseTabActionDeps) {

  const onCloseTab = useCallback(
    (id: string, opts?: { confirmedTerminalIds?: string[] }) => {
      if (windowTransferPendingRef.current || movingTabIds.current.has(id)) return;
      const current = tabsRef.current;
      const index = current.findIndex((t) => t.id === id);
      if (index < 0) return;
      const closePlan = planWorkspaceTabClose({
        tabs: current,
        sessions: sessionsRef.current,
        closingTabId: id,
        scope: tabCloseScope,
        worktreeOf: tabWorktreeOf,
      });
      if (closePlan.action === "keep") return;
      const closing = current[index];
      const closingFiles = [
        ...closing.editorPanes.flatMap((pane) => pane.files),
        ...(closing.terminalPanes ?? []).flatMap((pane) => pane.files),
      ];
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );
      const confirmed = new Set(opts?.confirmedTerminalIds ?? []);
      const terminals = closingFiles.filter((file) => file.terminal && !confirmed.has(file.id));

      const finishClose = () => {
        if (windowTransferPendingRef.current || movingTabIds.current.has(id)) return;
        const nextActiveTabId = closePlan.nextActiveTabId;
        const next = current.filter((t) => t.id !== id);
        const gone = new Set(
          leafIds(closing.layout).filter((paneId) =>
            sessionsRef.current.some((session) => session.id === paneId),
          ),
        );
        for (const sessionId of gone) {
          persistSession(sessionsRef.current.find((s) => s.id === sessionId));
          rememberRemoteSession(sessionId);
          rememberRemotePendingWorktree(sessionId);
        }
        setDirtyFiles((prev) => {
          const updated = new Set(prev);
          for (const file of closingFiles) updated.delete(file.id);
          return updated;
        });
        setTabs(next);
        if (id === activeTabIdRef.current && nextActiveTabId) {
          activateTab(nextActiveTabId);
        }
        void refreshHistory(sidebarCwd);
      };

      void (async () => {
        if (
          !(await confirmWorkspaceClose(
            unsaved.length > 0
              ? () => confirmDiscardUnsaved("Close this tab with unsaved files?")
              : undefined,
            terminals.length > 0 ? () => confirmCloseTerminals(terminals) : undefined,
          ))
        )
          return;
        finishClose();
      })();
    },
    [activateTab, persistSession, refreshHistory, sidebarCwd, tabCloseScope],
  );

  const onCloseTabs = useCallback(
    (ids: string[], fallbackId: string, opts?: { confirmed?: boolean }) => {
      if (windowTransferPendingRef.current || ids.some((id) => movingTabIds.current.has(id)))
        return;
      const current = tabsRef.current;
      const closingIds = new Set(ids);
      const closing = current.filter((tab) => closingIds.has(tab.id));
      const fallback = current.find((tab) => tab.id === fallbackId && !closingIds.has(tab.id));
      if (!fallback || closing.length === 0) return;

      const closingFiles = closing.flatMap((tab) => [
        ...tab.editorPanes.flatMap((pane) => pane.files),
        ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
      ]);
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );
      const terminals = closingFiles.filter((file) => file.terminal);

      const finishClose = () => {
        if (
          windowTransferPendingRef.current ||
          closing.some((tab) => movingTabIds.current.has(tab.id))
        )
          return;
        const sessionIds = new Set(
          closing.flatMap((tab) =>
            leafIds(tab.layout).filter((paneId) =>
              sessionsRef.current.some((session) => session.id === paneId),
            ),
          ),
        );
        for (const sessionId of sessionIds) {
          persistSession(sessionsRef.current.find((session) => session.id === sessionId));
          rememberRemoteSession(sessionId);
          rememberRemotePendingWorktree(sessionId);
        }
        setDirtyFiles((prev) => {
          const next = new Set(prev);
          for (const file of closingFiles) next.delete(file.id);
          return next;
        });
        setTabs((prev) => prev.filter((tab) => !closingIds.has(tab.id)));
        if (closingIds.has(activeTabIdRef.current)) activateTab(fallback.id);
        void refreshHistory(sidebarCwd);
      };

      // The caller already confirmed unsaved files and terminals.
      if (opts?.confirmed) {
        finishClose();
        return;
      }

      void (async () => {
        if (
          !(await confirmWorkspaceClose(
            unsaved.length > 0
              ? () => confirmDiscardUnsaved("Close these tabs with unsaved files?")
              : undefined,
            terminals.length > 0 ? () => confirmCloseTerminals(terminals) : undefined,
          ))
        )
          return;
        finishClose();
      })();
    },
    [activateTab, persistSession, refreshHistory, sidebarCwd],
  );

  const onCloseOtherTabs = useCallback(() => {
    const current = tabsRef.current;
    const activeId = activeTabIdRef.current;
    if (!current.some((tab) => tab.id === activeId)) return;
    onCloseTabs(
      current.filter((tab) => tab.id !== activeId).map((tab) => tab.id),
      activeId,
    );
  }, [onCloseTabs]);

  return { onCloseTab, onCloseTabs, onCloseOtherTabs };
}
