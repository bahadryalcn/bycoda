import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { flushSync } from "react-dom";
import { confirmWorkspaceClose } from "../../model/closeConfirmation";
import { basename } from "../../../platform/tauri/fs";
import {
  confirmCloseTerminal,
  confirmCloseTerminals,
} from "../../../features/terminal/model/terminalClose";
import {
  findSurfacePane,
  firstLeafId,
  isFilesystemTab,
  leaf,
  removePane,
  siblingLeafId,
  surfacePanes,
  withSurfacePanes,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { planWorkspaceTabClose } from "../../../features/workspace/model/workspaceTabGroups";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { confirmDiscardUnsaved } from "../helpers/appHelpers";
import type { useCloseTabActions } from "../tabs/useCloseTabActions";

export interface EditorFileCloseDeps {
  activeTabId: string;
  projectCwd: string;
  tabCloseScope: "project";
  tabWorktreeOf: (tab: WorkspaceTab) => string | null;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  sessionsRef: MutableRefObject<Session[]>;
  dirtyFilesRef: MutableRefObject<Set<string>>;
  isMovingPane: (paneId: string) => boolean;
  onCloseTab: ReturnType<typeof useCloseTabActions>["onCloseTab"];
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
}

export interface EditorFileClose {
  onCloseFile: (paneId: string, fileId: string, opts?: { skipConfirm?: boolean }) => void;
  onCloseOtherFiles: (paneId: string, fileId: string, direction?: "left" | "right") => void;
}

/** Closes one editor file, or other files in its pane (optionally on one side). */
export function useEditorFileClose(deps: EditorFileCloseDeps): EditorFileClose {
  const {
    activeTabId,
    projectCwd,
    tabCloseScope,
    tabWorktreeOf,
    tabsRef,
    sessionsRef,
    dirtyFilesRef,
    isMovingPane,
    onCloseTab,
    setDirtyFiles,
    setSessions,
    setTabs,
    setComposerFocused,
  } = deps;

  const onCloseFile = useCallback(
    (paneId: string, fileId: string, opts?: { skipConfirm?: boolean }) => {
      if (isMovingPane(paneId)) return;
      const tab = tabsRef.current.find((entry) => findSurfacePane(entry, paneId));
      if (!tab) return;
      const found = findSurfacePane(tab, paneId);
      if (!found) return;
      const { pane } = found;
      const index = pane.files.findIndex((file) => file.id === fileId);
      if (index < 0) return;
      const file = pane.files[index];
      const needsUnsavedConfirm =
        !opts?.skipConfirm && isFilesystemTab(file) && dirtyFilesRef.current.has(fileId);

      const closingTabId = tab.id;
      const finishClose = () => {
        // Include queued React updates before deciding whether the last pane needs
        // a new session. Keep session creation and onCloseTab outside the updater.
        let currentTabs = tabsRef.current;
        flushSync(() =>
          setTabs((previous) => {
            currentTabs = previous;
            return previous;
          }),
        );
        // Confirmation may have yielded while files, panes or the whole tab changed.
        const currentTab = currentTabs.find((entry) => entry.id === closingTabId);
        const current = currentTab && findSurfacePane(currentTab, paneId);
        if (!currentTab || !current || isMovingPane(paneId)) return;
        const tab = currentTab;
        const { pane } = current;
        const index = pane.files.findIndex((entry) => entry.id === fileId);
        if (index < 0) return;
        const files = pane.files.filter((entry) => entry.id !== fileId);
        let nextFocus = tab.focusedId;
        if (files.length === 0) {
          const sibling = siblingLeafId(tab.layout, paneId);
          const withoutPane = removePane(tab.layout, paneId);
          if (!withoutPane) {
            setDirtyFiles((prev) => {
              const next = new Set(prev);
              next.delete(fileId);
              return next;
            });
            const closePlan = planWorkspaceTabClose({
              tabs: currentTabs,
              sessions: sessionsRef.current,
              closingTabId: tab.id,
              scope: tabCloseScope,
              worktreeOf: tabWorktreeOf,
            });
            if (closePlan.action === "close") {
              onCloseTab(tab.id, file.terminal ? { confirmedTerminalIds: [fileId] } : undefined);
              return;
            }
            const seed = sessionsRef.current[0];
            const session = newSession(
              seed?.harness ?? "claude",
              file.cwd || projectCwd,
              seed?.model,
              seed?.runtimeMode,
              seed?.modelSettings,
            );
            setSessions((prev) => [...prev, session]);
            setTabs((prev) =>
              prev.map((entry) =>
                entry.id === tab.id
                  ? {
                      ...entry,
                      layout: leaf(session.id),
                      focusedId: session.id,
                      editorPanes: [],
                      terminalPanes: [],
                      diffOpen: false,
                      diffFocused: false,
                    }
                  : entry,
              ),
            );
            setComposerFocused(true);
            return;
          }
          nextFocus =
            tab.focusedId === paneId ? (sibling ?? firstLeafId(withoutPane)) : tab.focusedId;
        }

        setTabs((prev) =>
          prev.map((entry) => {
            if (entry.id !== tab.id) return entry;
            const current = findSurfacePane(entry, paneId);
            if (!current) return entry;
            const index = current.pane.files.findIndex((file) => file.id === fileId);
            if (index < 0) return entry;
            const files = current.pane.files.filter((file) => file.id !== fileId);
            const layout = files.length ? entry.layout : removePane(entry.layout, paneId);
            if (!layout) return entry;
            return withSurfacePanes(
              {
                ...entry,
                layout,
                focusedId:
                  entry.focusedId !== paneId
                    ? entry.focusedId
                    : files.length
                      ? paneId
                      : (siblingLeafId(entry.layout, paneId) ?? firstLeafId(layout)),
              },
              current.kind,
              surfacePanes(entry, current.kind).flatMap((pane) =>
                pane.id !== paneId
                  ? [pane]
                  : files.length
                    ? [
                        {
                          ...pane,
                          files,
                          activeFileId:
                            pane.activeFileId === fileId
                              ? files[Math.min(index, files.length - 1)].id
                              : pane.activeFileId,
                        },
                      ]
                    : [],
              ),
            );
          }),
        );
        setDirtyFiles((prev) => {
          const next = new Set(prev);
          next.delete(fileId);
          return next;
        });
        if (tab.id === activeTabId && files.length === 0) {
          setComposerFocused(sessionsRef.current.some((session) => session.id === nextFocus));
        }
      };

      void (async () => {
        if (
          !(await confirmWorkspaceClose(
            needsUnsavedConfirm
              ? () => confirmDiscardUnsaved(`Close ${basename(file.path)} without saving?`)
              : undefined,
            file.terminal && !opts?.skipConfirm ? () => confirmCloseTerminal(file) : undefined,
          ))
        )
          return;
        finishClose();
      })();
    },
    [activeTabId, onCloseTab, projectCwd, tabCloseScope],
  );

  const onCloseOtherFiles = useCallback(
    (paneId: string, fileId: string, direction?: "left" | "right") => {
      if (isMovingPane(paneId)) return;
      const tab = tabsRef.current.find((entry) => findSurfacePane(entry, paneId));
      if (!tab) return;
      const found = findSurfacePane(tab, paneId);
      if (!found) return;
      const index = found.pane.files.findIndex((file) => file.id === fileId);
      if (index < 0) return;
      const closingFiles = found.pane.files.filter((file, fileIndex) =>
        direction === "left"
          ? fileIndex < index
          : direction === "right"
            ? fileIndex > index
            : file.id !== fileId,
      );
      if (closingFiles.length === 0) return;
      const closingIds = new Set(closingFiles.map((file) => file.id));
      const unsaved = closingFiles.filter(
        (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
      );
      const terminals = closingFiles.filter((file) => file.terminal);

      const finishClose = async () => {
        const confirmedDirtyIds = new Set(unsaved.map((file) => file.id));
        while (true) {
          let latest = tabsRef.current;
          flushSync(() =>
            setTabs((previous) => {
              latest = previous;
              return previous;
            }),
          );
          const currentTab = latest.find((entry) => entry.id === tab.id);
          const current = currentTab && findSurfacePane(currentTab, paneId);
          if (
            !current ||
            isMovingPane(paneId) ||
            !current.pane.files.some((file) => file.id === fileId)
          )
            return;
          const newlyDirty = current.pane.files.filter(
            (file) =>
              closingIds.has(file.id) &&
              isFilesystemTab(file) &&
              dirtyFilesRef.current.has(file.id) &&
              !confirmedDirtyIds.has(file.id),
          );
          if (newlyDirty.length === 0) break;
          if (
            !(await confirmWorkspaceClose(() =>
              confirmDiscardUnsaved("Close other tabs with unsaved files?"),
            ))
          )
            return;
          for (const file of newlyDirty) confirmedDirtyIds.add(file.id);
        }
        let removedIds = new Set<string>();
        flushSync(() =>
          setTabs((prev) => {
            removedIds = new Set();
            return prev.map((entry) => {
              if (entry.id !== tab.id) return entry;
              const current = findSurfacePane(entry, paneId);
              if (isMovingPane(paneId) || !current?.pane.files.some((file) => file.id === fileId)) {
                return entry;
              }
              const closing = current.pane.files.filter((file) => closingIds.has(file.id));
              if (
                closing.some(
                  (file) =>
                    isFilesystemTab(file) &&
                    dirtyFilesRef.current.has(file.id) &&
                    !confirmedDirtyIds.has(file.id),
                )
              )
                return entry;
              removedIds = new Set(closing.map((file) => file.id));
              return withSurfacePanes(
                { ...entry, focusedId: paneId },
                current.kind,
                surfacePanes(entry, current.kind).map((pane) =>
                  pane.id === paneId
                    ? {
                        ...pane,
                        files: pane.files.filter((file) => !closingIds.has(file.id)),
                        activeFileId: fileId,
                      }
                    : pane,
                ),
              );
            });
          }),
        );
        if (removedIds.size === 0) return;
        setDirtyFiles((prev) => {
          const next = new Set(prev);
          for (const id of removedIds) next.delete(id);
          return next;
        });
      };

      void (async () => {
        if (
          !(await confirmWorkspaceClose(
            unsaved.length > 0
              ? () => confirmDiscardUnsaved("Close other tabs with unsaved files?")
              : undefined,
            terminals.length > 0 ? () => confirmCloseTerminals(terminals) : undefined,
          ))
        )
          return;
        await finishClose();
      })();
    },
    [],
  );

  return { onCloseFile, onCloseOtherFiles };
}
