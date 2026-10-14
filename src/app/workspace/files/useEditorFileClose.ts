import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
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
  onCloseOtherFiles: (paneId: string, fileId: string) => void;
}

/** Closes one editor file, or every other file in its pane. */
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
      const { kind, pane } = found;
      const index = pane.files.findIndex((file) => file.id === fileId);
      if (index < 0) return;
      const file = pane.files[index];
      const needsUnsavedConfirm =
        !opts?.skipConfirm && isFilesystemTab(file) && dirtyFilesRef.current.has(fileId);

      const finishClose = () => {
        const files = pane.files.filter((entry) => entry.id !== fileId);
        let nextFocus = tab.focusedId;
        let nextLayout = tab.layout;
        let nextPanes = surfacePanes(tab, kind);
        if (files.length > 0) {
          nextFocus = paneId;
          const activeFileId =
            pane.activeFileId === fileId
              ? files[Math.min(index, files.length - 1)].id
              : pane.activeFileId;
          nextPanes = nextPanes.map((entry) =>
            entry.id === paneId ? { ...entry, files, activeFileId } : entry,
          );
        } else {
          const sibling = siblingLeafId(tab.layout, paneId);
          const withoutPane = removePane(tab.layout, paneId);
          if (!withoutPane) {
            setDirtyFiles((prev) => {
              const next = new Set(prev);
              next.delete(fileId);
              return next;
            });
            const closePlan = planWorkspaceTabClose({
              tabs: tabsRef.current,
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
          nextLayout = withoutPane;
          nextFocus =
            tab.focusedId === paneId ? (sibling ?? firstLeafId(withoutPane)) : tab.focusedId;
          nextPanes = nextPanes.filter((entry) => entry.id !== paneId);
        }

        setTabs((prev) =>
          prev.map((entry) =>
            entry.id === tab.id
              ? withSurfacePanes(
                  {
                    ...entry,
                    layout: nextLayout,
                    focusedId: nextFocus,
                  },
                  kind,
                  nextPanes,
                )
              : entry,
          ),
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

  const onCloseOtherFiles = useCallback((paneId: string, fileId: string) => {
    if (isMovingPane(paneId)) return;
    const tab = tabsRef.current.find((entry) => findSurfacePane(entry, paneId));
    if (!tab) return;
    const found = findSurfacePane(tab, paneId);
    if (!found?.pane.files.some((file) => file.id === fileId)) return;
    const closingFiles = found.pane.files.filter((file) => file.id !== fileId);
    if (closingFiles.length === 0) return;
    const closingIds = new Set(closingFiles.map((file) => file.id));
    const unsaved = closingFiles.filter(
      (file) => isFilesystemTab(file) && dirtyFilesRef.current.has(file.id),
    );
    const terminals = closingFiles.filter((file) => file.terminal);

    const finishClose = () => {
      setTabs((prev) =>
        prev.map((entry) => {
          if (entry.id !== tab.id) return entry;
          const current = findSurfacePane(entry, paneId);
          if (!current?.pane.files.some((file) => file.id === fileId)) {
            return entry;
          }
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
        }),
      );
      setDirtyFiles((prev) => {
        const next = new Set(prev);
        for (const id of closingIds) next.delete(id);
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
      finishClose();
    })();
  }, []);

  return { onCloseFile, onCloseOtherFiles };
}
