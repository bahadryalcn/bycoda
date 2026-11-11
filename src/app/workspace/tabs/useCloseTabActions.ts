import {
  useCallback,
  useLayoutEffect,
  useRef,
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
  workspaceTabCwd,
  type WorkspaceTabCloseScope,
} from "../../../features/workspace/model/workspaceTabGroups";
import { sameProjectPath } from "../../../features/projects/model/recents";
import { type Session } from "../../../features/sessions/model/session";
import { confirmWorkspaceClose } from "../../model/closeConfirmation";
import { confirmDiscardUnsaved } from "../helpers/appHelpers";
import { t } from "../../../shared/i18n";
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
  type CloseCommit = { closing: WorkspaceTab[]; next: WorkspaceTab[]; nextActiveTabId?: string };
  const pending = useRef<{ checked: boolean; commit?: CloseCommit }[]>([]);
  const closePolicy = useRef({ tabCloseScope, tabWorktreeOf, sidebarCwd });
  closePolicy.current = { tabCloseScope, tabWorktreeOf, sidebarCwd };

  // React can defer or replay functional updaters. External effects belong to
  // the committed removal, never to the stale pre-confirmation snapshot.
  useLayoutEffect(() => {
    const ready = pending.current.filter((entry) => entry.checked);
    pending.current = pending.current.filter((entry) => !entry.checked);
    for (const { commit } of ready) {
      if (
        !commit ||
        commit.closing.some((tab) => tabsRef.current.some((current) => current.id === tab.id))
      )
        continue;
      const closingIds = new Set(commit.closing.map((tab) => tab.id));
      const sessionIds = new Set(commit.closing.flatMap((tab) => leafIds(tab.layout)));
      for (const sessionId of sessionIds) {
        const session = sessionsRef.current.find((value) => value.id === sessionId);
        if (!session) continue;
        persistSession(session);
        rememberRemoteSession(sessionId);
        rememberRemotePendingWorktree(sessionId);
      }
      const files = commit.closing.flatMap((tab) => [
        ...tab.editorPanes.flatMap((pane) => pane.files),
        ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
      ]);
      setDirtyFiles((previous) => {
        const next = new Set(previous);
        for (const file of files) next.delete(file.id);
        return next;
      });
      if (closingIds.has(activeTabIdRef.current)) {
        const fallback =
          tabsRef.current.find((tab) => tab.id === commit.nextActiveTabId) ??
          tabsRef.current.find((tab) => {
            const cwd = workspaceTabCwd(tab, sessionsRef.current);
            return cwd !== null && sameProjectPath(cwd, sidebarCwd);
          }) ??
          tabsRef.current[0];
        if (fallback) activateTab(fallback.id);
      }
      void refreshHistory(sidebarCwd);
    }
  });

  const commitClose = useCallback(
    (build: (previous: WorkspaceTab[]) => CloseCommit | undefined) => {
      const entry: { checked: boolean; commit?: CloseCommit } = { checked: false };
      pending.current.push(entry);
      setTabs((previous) => {
        entry.checked = true;
        entry.commit = build(previous);
        return entry.commit?.next ?? previous;
      });
    },
    [setTabs],
  );
  const onCloseTab = useCallback(
    (id: string, opts?: { confirmedTerminalIds?: string[] }) => {
      if (windowTransferPendingRef.current || movingTabIds.current.has(id)) return;
      const approvedDirty = new Set<string>();
      const confirmed = new Set(opts?.confirmedTerminalIds ?? []);
      const readClose = (current = tabsRef.current) => {
        if (windowTransferPendingRef.current || movingTabIds.current.has(id)) return;
        const closing = current.find((tab) => tab.id === id);
        if (!closing) return;
        const plan = planWorkspaceTabClose({
          tabs: current,
          sessions: sessionsRef.current,
          closingTabId: id,
          scope: closePolicy.current.tabCloseScope,
          worktreeOf: closePolicy.current.tabWorktreeOf,
          activeCwd: closePolicy.current.sidebarCwd,
        });
        if (plan.action === "keep") return;
        const files = [
          ...closing.editorPanes.flatMap((pane) => pane.files),
          ...(closing.terminalPanes ?? []).flatMap((pane) => pane.files),
        ];
        return {
          closing,
          plan,
          files,
          unsaved: files.filter(
            (file) =>
              isFilesystemTab(file) &&
              dirtyFilesRef.current.has(file.id) &&
              !approvedDirty.has(file.id),
          ),
          terminals: files.filter((file) => file.terminal && !confirmed.has(file.id)),
        };
      };

      void (async () => {
        // Every await invalidates the workspace snapshot, including the dirty
        // files and fallback. Confirm newly affected resources before retrying.
        let state;
        while ((state = readClose())) {
          if (state.unsaved.length) {
            const unsavedFiles = state.unsaved;
            if (
              !(await confirmWorkspaceClose(() =>
                confirmDiscardUnsaved({
                  title: t("Close tab with unsaved files?"),
                  confirmLabel: t("Discard and close"),
                  files: unsavedFiles,
                }),
              ))
            )
              return;
            for (const file of unsavedFiles) approvedDirty.add(file.id);
            continue;
          }
          if (state.terminals.length) {
            const terminals = state.terminals;
            if (!(await confirmWorkspaceClose(undefined, () => confirmCloseTerminals(terminals))))
              return;
            for (const file of terminals) confirmed.add(file.id);
            continue;
          }
          break;
        }
        if (!state) return;
        commitClose((previous) => {
          const latest = readClose(previous);
          if (!latest || latest.unsaved.length || latest.terminals.length) return;
          return {
            closing: [latest.closing],
            next: previous.filter((tab) => tab.id !== id),
            nextActiveTabId: latest.plan.nextActiveTabId,
          };
        });
      })();
    },
    [commitClose],
  );

  const onCloseTabs = useCallback(
    (
      ids: string[],
      fallbackId: string,
      opts?: {
        confirmed?: boolean;
        /**
         * Automatic closes only: decided again right before the tabs are removed,
         * after any confirmation await. A tab for which it returns false is kept.
         */
        stillClosable?: (tabId: string) => boolean | Promise<boolean>;
      },
    ) => {
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

      const finishClose = async () => {
        if (opts?.stillClosable) {
          for (const id of ids) {
            try {
              if ((await opts.stillClosable(id)) === false) closingIds.delete(id);
            } catch {
              closingIds.delete(id);
            }
          }
        }
        const remainingIds = ids.filter((id) => closingIds.has(id));
        if (remainingIds.length === 0) return;
        const latest = tabsRef.current;
        const sameIdentity = (left: WorkspaceTab, right: WorkspaceTab) =>
          left.id === right.id &&
          JSON.stringify(leafIds(left.layout)) === JSON.stringify(leafIds(right.layout));
        const latestClosing = latest.filter(
          (tab) =>
            closingIds.has(tab.id) && closing.some((original) => sameIdentity(original, tab)),
        );
        for (const id of closingIds)
          if (!latestClosing.some((tab) => tab.id === id)) closingIds.delete(id);
        const latestFallback =
          latest.find((tab) => tab.id === fallbackId && !closingIds.has(tab.id)) ??
          latest.find((tab) => !closingIds.has(tab.id));
        if (!latestFallback || !latestClosing.length) return;
        if (
          windowTransferPendingRef.current ||
          latestClosing.some((tab) => movingTabIds.current.has(tab.id))
        )
          return;
        const latestFiles = latestClosing.flatMap((tab) => [
          ...tab.editorPanes.flatMap((pane) => pane.files),
          ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
        ]);
        if (
          latestFiles.some(
            (file) =>
              (isFilesystemTab(file) &&
                dirtyFilesRef.current.has(file.id) &&
                !unsaved.some((approved) => approved.id === file.id)) ||
              (file.terminal && !terminals.some((approved) => approved.id === file.id)),
          )
        ) {
          // The caller's approval cannot cover files added while it waited.
          onCloseTabs(remainingIds, latestFallback.id, opts);
          return;
        }
        commitClose((previous) => {
          if (
            previous.some(
              (tab) =>
                closingIds.has(tab.id) &&
                !latestClosing.some((latestTab) => sameIdentity(latestTab, tab)),
            )
          )
            return;
          const closing = previous.filter((tab) => closingIds.has(tab.id));
          const next = previous.filter((tab) => !closingIds.has(tab.id));
          if (
            !closing.length ||
            !next.length ||
            windowTransferPendingRef.current ||
            closing.some((tab) => movingTabIds.current.has(tab.id))
          )
            return;
          const files = closing.flatMap((tab) => [
            ...tab.editorPanes.flatMap((pane) => pane.files),
            ...(tab.terminalPanes ?? []).flatMap((pane) => pane.files),
          ]);
          if (
            files.some(
              (file) =>
                (isFilesystemTab(file) &&
                  dirtyFilesRef.current.has(file.id) &&
                  !unsaved.some((approved) => approved.id === file.id)) ||
                (file.terminal && !terminals.some((approved) => approved.id === file.id)),
            )
          )
            return;
          return {
            closing,
            next,
            nextActiveTabId: next.find((tab) => tab.id === latestFallback.id)?.id ?? next[0].id,
          };
        });
      };

      // The caller already confirmed unsaved files and terminals.
      if (opts?.confirmed) {
        void finishClose().catch(console.error);
        return;
      }

      void (async () => {
        if (
          !(await confirmWorkspaceClose(
            unsaved.length > 0
              ? () =>
                  confirmDiscardUnsaved({
                    title: t("Close tabs with unsaved files?"),
                    confirmLabel: t("Discard and close"),
                    files: unsaved,
                  })
              : undefined,
            terminals.length > 0 ? () => confirmCloseTerminals(terminals) : undefined,
          ))
        )
          return;
        await finishClose();
      })().catch(console.error);
    },
    [commitClose],
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
