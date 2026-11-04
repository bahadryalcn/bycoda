import {
  useCallback,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
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
import { confirmReload, hasInFlightSessions } from "../../model/appLifecycle";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";

export interface WindowChromeActionDeps {
  /** Committed values, so the toggles persist outside a state updater. */
  projectRailOpen: boolean;
  sessionSidebarOpen: boolean;
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
    projectRailOpen,
    sessionSidebarOpen,
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

  // The toggles compute the next value from the committed state and persist it
  // once here; a state updater is not a safe place for storage writes. The ref
  // also covers a second toggle before React re-renders.
  const openRef = useRef({ projectRail: projectRailOpen, sessionSidebar: sessionSidebarOpen });
  useLayoutEffect(() => {
    openRef.current = { projectRail: projectRailOpen, sessionSidebar: sessionSidebarOpen };
  }, [projectRailOpen, sessionSidebarOpen]);

  const onToggleProjectRail = useCallback(() => {
    const next = !openRef.current.projectRail;
    openRef.current.projectRail = next;
    setProjectRailOpen(next);
    saveProjectRailOpen(next);
  }, []);
  const onToggleSidebar = onToggleProjectRail;

  const onToggleSessionSidebar = useCallback(() => {
    const next = !openRef.current.sessionSidebar;
    openRef.current.sessionSidebar = next;
    setSessionSidebarOpen(next);
    saveSessionSidebarOpen(next);
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
      if (
        !(await confirmReload(
          dirtyFilesRef.current.size > 0,
          hasInFlightSessions(sessionsRef.current),
        ))
      )
        return;
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
