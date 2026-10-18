import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { message } from "@tauri-apps/plugin-dialog";
import { flushSync } from "react-dom";
import { t } from "../../../shared/i18n";
import type { Session } from "../../../features/sessions/model/session";
import {
  findSurfacePane,
  isFilesystemTab,
  leafIds,
  newEditorWorkspaceTab,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import {
  dropWindowMoves,
  settlePendingWindowMoves,
  type PendingWindowMoves,
  type WindowMovePosition,
} from "../../model/windowTransferPopout";
import type { WindowTransferPayload } from "../../model/windowTransfer";
import type { EditorFileClose } from "../files/useEditorFileClose";
import type { MoveTabsOptions } from "./useMoveTabsToNewWindow";
import { cancelWindowMoveTiming } from "../../model/windowMoveTiming";

export interface WindowMoveActionDeps {
  pendingWindowMoves: PendingWindowMoves;
  tabs: WorkspaceTab[];
  sessions: Session[];
  setPendingWindowMoves: Dispatch<SetStateAction<PendingWindowMoves>>;
  onMoveTabsToNewWindow: (tabIds: string[], opts?: MoveTabsOptions) => Promise<unknown>;
  onCloseFile: EditorFileClose["onCloseFile"];
  isMovingPane: (paneId: string) => boolean;
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  dirtyFilesRef: MutableRefObject<Set<string>>;
  projectCwdRef: MutableRefObject<string>;
  openingFileWindowIds: MutableRefObject<Set<string>>;
  movingTabIds: MutableRefObject<Set<string>>;
  movingSessionIds: MutableRefObject<Set<string>>;
  setMovingWindows: Dispatch<SetStateAction<Set<string>>>;
}

/** Queued window moves, cancel, and opening a single file in a new window. */
export function useWindowMoveActions(deps: WindowMoveActionDeps): {
  onCancelMoveToNewWindow: (tabId: string) => void;
  onOpenFileInNewWindow: (
    paneId: string,
    fileId: string,
    position?: WindowMovePosition,
  ) => Promise<void>;
} {
  const {
    pendingWindowMoves,
    tabs,
    sessions,
    setPendingWindowMoves,
    onMoveTabsToNewWindow,
    onCloseFile,
    isMovingPane,
    tabsRef,
    dirtyFilesRef,
    projectCwdRef,
    openingFileWindowIds,
    movingTabIds,
    movingSessionIds,
    setMovingWindows,
  } = deps;

  useEffect(() => {
    const { ready, gone } = settlePendingWindowMoves(pendingWindowMoves, tabs, sessions);
    if (ready.length === 0 && gone.length === 0) return;
    for (const id of gone) cancelWindowMoveTiming([id]);
    setPendingWindowMoves((prev) => dropWindowMoves(prev, [...ready, ...gone]));
    for (const id of ready) {
      void onMoveTabsToNewWindow([id], {
        position:
          pendingWindowMoves[id]?.x !== undefined && pendingWindowMoves[id]?.y !== undefined
            ? (pendingWindowMoves[id] as {
                x: number;
                y: number;
                clientX?: number;
                clientY?: number;
              })
            : undefined,
        targetWindowLabel: pendingWindowMoves[id]?.targetWindowLabel,
      });
    }
  }, [pendingWindowMoves, tabs, sessions, onMoveTabsToNewWindow]);

  const onCancelMoveToNewWindow = useCallback((tabId: string) => {
    cancelWindowMoveTiming([tabId]);
    setPendingWindowMoves((prev) => dropWindowMoves(prev, [tabId]));
  }, []);

  /** Moves one file tab into a new window as its own editor tab. */
  const onOpenFileInNewWindow = useCallback(
    async (paneId: string, fileId: string, position?: WindowMovePosition) => {
      if (openingFileWindowIds.current.has(fileId) || isMovingPane(paneId)) return;
      const sourceTab = tabsRef.current.find((entry) => findSurfacePane(entry, paneId));
      if (!sourceTab) return;
      const found = tabsRef.current
        .map((tab) => findSurfacePane(tab, paneId))
        .find((entry) => entry?.kind === "editor");
      const file = found?.pane.files.find((entry) => entry.id === fileId);
      if (!file || !isFilesystemTab(file) || dirtyFilesRef.current.has(fileId)) {
        return;
      }
      if (leafIds(sourceTab.layout).length === 1 && found!.pane.files.length === 1) {
        await onMoveTabsToNewWindow([sourceTab.id], { position });
        return;
      }
      const tab = newEditorWorkspaceTab({ ...file, preview: false });
      openingFileWindowIds.current.add(fileId);
      movingTabIds.current.add(sourceTab.id);
      flushSync(() => setMovingWindows(new Set(movingTabIds.current)));
      const lockedIds = leafIds(sourceTab.layout);
      for (const id of lockedIds) movingSessionIds.current.add(id);
      try {
        await invoke("move_window_tabs", {
          transfer: JSON.stringify({
            tabs: [tab],
            sessions: [],
            activeTabId: tab.id,
            projectCwd: file.cwd || projectCwdRef.current,
            dirtyFileIds: [],
          } satisfies WindowTransferPayload),
          targetWindowLabel: position?.targetWindowLabel ?? null,
          x: position?.x ?? null,
          y: position?.y ?? null,
          clientX: position?.clientX ?? null,
          clientY: position?.clientY ?? null,
          pixelRatio: position?.pixelRatio ?? null,
          relocate: false,
        });
        movingTabIds.current.delete(sourceTab.id);
        for (const id of lockedIds) movingSessionIds.current.delete(id);
        // An edit made while the destination boots must stay in this editor.
        if (!dirtyFilesRef.current.has(fileId)) {
          onCloseFile(paneId, fileId, { skipConfirm: true });
        }
      } catch (error) {
        void message(
          `Could not open the file in a new window. The original editor is still here.\n\n${error instanceof Error ? error.message : String(error)}`,
          {
            get title() {
              return t("Open in new window");
            },
          },
        );
      } finally {
        openingFileWindowIds.current.delete(fileId);
        movingTabIds.current.delete(sourceTab.id);
        for (const id of lockedIds) movingSessionIds.current.delete(id);
        setMovingWindows(new Set(movingTabIds.current));
      }
    },
    [onCloseFile, onMoveTabsToNewWindow],
  );

  return { onCancelMoveToNewWindow, onOpenFileInNewWindow };
}
