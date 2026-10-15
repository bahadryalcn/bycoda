import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { invalidateProjectFiles } from "../../../features/files/model/fileIndex";
import { isEqualOrInside, rebasePath } from "../../../shared/lib/paths";
import {
  findSurfacePane,
  isFilesystemTab,
  pinEditorFile,
  selectPaneTab,
  surfacePanes,
  withSurfacePanes,
  type WorkspaceTab,
} from "../../../features/workspace/model/layout";
import { dropOpenFiles } from "../helpers/tabHelpers";

export interface EditorFileEventDeps {
  tabsRef: MutableRefObject<WorkspaceTab[]>;
  setTabs: (update: WorkspaceTab[] | ((previous: WorkspaceTab[]) => WorkspaceTab[])) => void;
  setDirtyFiles: Dispatch<SetStateAction<Set<string>>>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
}

export interface EditorFileEvents {
  onFileMoved: (from: string, to: string) => void;
  onFileDeleted: (path: string) => void;
  onPinFile: (fileId: string) => void;
  onFileDirtyChange: (fileId: string, dirty: boolean) => void;
  onSelectFileSurface: (paneId: string, fileId: string) => void;
}

/** Reacts to file moves, deletes, pins, dirty state and pane file selection. */
export function useEditorFileEvents(deps: EditorFileEventDeps): EditorFileEvents {
  const { tabsRef, setTabs, setDirtyFiles, setComposerFocused } = deps;

  const onFileMoved = useCallback((from: string, to: string) => {
    invalidateProjectFiles();
    setTabs((prev) =>
      prev.map((tab) => {
        return {
          ...tab,
          editorPanes: tab.editorPanes.map((pane) => ({
            ...pane,
            files: pane.files.map((file) => ({
              ...file,
              cwd: rebasePath(file.cwd, from, to),
              ...(file.projectCwd ? { projectCwd: rebasePath(file.projectCwd, from, to) } : {}),
              ...(isFilesystemTab(file) ? { path: rebasePath(file.path, from, to) } : {}),
            })),
          })),
        };
      }),
    );
  }, []);

  const onFileDeleted = useCallback((path: string) => {
    invalidateProjectFiles();
    const dropped = new Set<string>();
    for (const tab of tabsRef.current) {
      for (const pane of tab.editorPanes) {
        for (const file of pane.files) {
          if (isFilesystemTab(file) && isEqualOrInside(file.path, path)) {
            dropped.add(file.id);
          }
        }
      }
    }
    setTabs((prev) =>
      prev.map((tab) => dropOpenFiles(tab, (filePath) => isEqualOrInside(filePath, path))),
    );
    if (dropped.size === 0) return;
    setDirtyFiles((prev) => {
      const next = new Set(prev);
      for (const id of dropped) next.delete(id);
      return next;
    });
  }, []);

  const onPinFile = useCallback((fileId: string) => {
    setTabs((prev) => {
      const next = prev.map((tab) => pinEditorFile(tab, fileId));
      return next.some((tab, index) => tab !== prev[index]) ? next : prev;
    });
  }, []);

  const onFileDirtyChange = useCallback(
    (fileId: string, dirty: boolean) => {
      // An edited preview must not be replaced by the next click.
      if (dirty) onPinFile(fileId);
      setDirtyFiles((prev) => {
        if (prev.has(fileId) === dirty) return prev;
        const next = new Set(prev);
        if (dirty) next.add(fileId);
        else next.delete(fileId);
        return next;
      });
    },
    [onPinFile],
  );

  const onSelectFileSurface = useCallback((paneId: string, fileId: string) => {
    setTabs((prev) =>
      prev.map((tab) => {
        const found = findSurfacePane(tab, paneId);
        if (!found) return tab;
        return withSurfacePanes(
          { ...tab, layout: selectPaneTab(tab.layout, paneId), focusedId: paneId },
          found.kind,
          surfacePanes(tab, found.kind).map((pane) =>
            pane.id === paneId ? { ...pane, activeFileId: fileId } : pane,
          ),
        );
      }),
    );
    setComposerFocused(false);
  }, []);

  return { onFileMoved, onFileDeleted, onPinFile, onFileDirtyChange, onSelectFileSurface };
}
