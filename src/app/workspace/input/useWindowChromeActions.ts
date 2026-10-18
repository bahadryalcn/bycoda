import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { SidebarTabId } from "../../../features/settings/model/appearance";
import {
  saveProjectRailOpen,
  saveSessionSidebarOpen,
} from "../../../features/settings/model/appearance";
import {
  applyUiScale,
  loadUiScale,
  saveUiScale,
  UI_SCALE_DEFAULT,
  zoomInUiScale,
  zoomOutUiScale,
} from "../../../features/settings/model/uiScale";
import { confirmReload } from "../../model/appLifecycle";

export interface WindowChromeActionDeps {
  setProjectRailOpen: Dispatch<SetStateAction<boolean>>;
  setSessionSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setSearchViewOpen: Dispatch<SetStateAction<boolean>>;
  setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
  setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
  setAutomationsViewOpen: Dispatch<SetStateAction<boolean>>;
  setServersViewOpen?: Dispatch<SetStateAction<boolean>>;
  setFilePickerOpen: Dispatch<SetStateAction<boolean>>;
  setFilePickerInitialQuery: Dispatch<SetStateAction<string>>;
  setFilePickerResetToken: Dispatch<SetStateAction<number>>;
  setSidebarTab: (tab: SidebarTabId, project?: string) => void;
  setFilesSearchOpen: Dispatch<SetStateAction<boolean>>;
  setSearchFocusToken: Dispatch<SetStateAction<number>>;
  dirtyFilesRef: MutableRefObject<Set<string>>;
}

export interface WindowChromeActions {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onToggleSidebar: () => void;
  onToggleSessionSidebar: () => void;
  onToggleProjectRail: () => void;
  onGoToFile: () => void;
  onOpenCommandPalette: () => void;
  onReload: () => void;
  onFindInProject: () => void;
}

/** Window zoom, sidebar/rail toggles, file-picker/find openers and reload. */
export function useWindowChromeActions(deps: WindowChromeActionDeps): WindowChromeActions {
  const {
    setProjectRailOpen,
    setSessionSidebarOpen,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setServersViewOpen,
    setFilePickerOpen,
    setFilePickerInitialQuery,
    setFilePickerResetToken,
    setSidebarTab,
    setFilesSearchOpen,
    setSearchFocusToken,
    dirtyFilesRef,
  } = deps;

  const onZoomIn = useCallback(() => {
    const next = saveUiScale(zoomInUiScale(loadUiScale()));
    void applyUiScale(next);
  }, []);
  const onZoomOut = useCallback(() => {
    const next = saveUiScale(zoomOutUiScale(loadUiScale()));
    void applyUiScale(next);
  }, []);
  const onZoomReset = useCallback(() => {
    saveUiScale(UI_SCALE_DEFAULT);
    void applyUiScale(UI_SCALE_DEFAULT);
  }, []);

  const onToggleSidebar = useCallback(() => {
    setProjectRailOpen((open) => {
      const next = !open;
      saveProjectRailOpen(next);
      return next;
    });
  }, []);

  const onToggleSessionSidebar = useCallback(() => {
    setSessionSidebarOpen((open) => {
      const next = !open;
      saveSessionSidebarOpen(next);
      return next;
    });
  }, []);

  const onToggleProjectRail = useCallback(() => {
    setProjectRailOpen((open) => {
      const next = !open;
      saveProjectRailOpen(next);
      return next;
    });
  }, []);

  const onGoToFile = useCallback(() => {
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    setServersViewOpen?.(false);
    setFilePickerInitialQuery("");
    setFilePickerResetToken((token) => token + 1);
    setFilePickerOpen(true);
  }, []);
  const onOpenCommandPalette = useCallback(() => {
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    setServersViewOpen?.(false);
    setFilePickerInitialQuery(">");
    setFilePickerResetToken((token) => token + 1);
    setFilePickerOpen(true);
  }, []);
  const onReload = useCallback(() => {
    void (async () => {
      if (!(await confirmReload(dirtyFilesRef.current.size > 0))) return;
      window.location.reload();
    })();
  }, []);

  const onFindInProject = useCallback(() => {
    setSearchViewOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    setServersViewOpen?.(false);
    setSidebarTab("files");
    setFilesSearchOpen(true);
    setSearchFocusToken((token) => token + 1);
  }, []);

  return {
    onZoomIn,
    onZoomOut,
    onZoomReset,
    onToggleSidebar,
    onToggleSessionSidebar,
    onToggleProjectRail,
    onGoToFile,
    onOpenCommandPalette,
    onReload,
    onFindInProject,
  };
}
