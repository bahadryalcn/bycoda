import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useSurfaceForwardHistory } from "../../hooks/useSurfaceForwardHistory";
import { loadNotesEnabled } from "../../../features/settings/model/settings";

export interface SettingsReturnView {
  search: boolean;
  inbox: boolean;
  notes: boolean;
  automations: boolean;
}

export interface RailNavigationDeps {
  activeTabId: string;
  projectCwd: string;
  settingsOpen: boolean;
  searchViewOpen: boolean;
  inboxViewOpen: boolean;
  notesViewOpen: boolean;
  automationsViewOpen: boolean;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setSearchViewOpen: Dispatch<SetStateAction<boolean>>;
  setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
  setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
  setAutomationsViewOpen: Dispatch<SetStateAction<boolean>>;
  settingsReturnViewRef: MutableRefObject<SettingsReturnView>;
  onCloseSettings: () => void;
  onVisitBack: () => void;
  onVisitForward: () => void;
}

export interface RailSurface {
  tabId: string;
  cwd: string;
  settings: boolean;
  search: boolean;
  inbox: boolean;
  notes: boolean;
  automations: boolean;
}

export interface RailNavigation {
  surfaceForward: {
    canForward: boolean;
    remember: (destination: RailSurface) => void;
    forward: () => boolean;
  };
  onRailBack: () => void;
  onRailForward: () => void;
}

/**
 * Rail back/forward: closes surfaces (settings, search, inbox, notes, automations)
 * before stepping tab visit history, and remembers dismissed surfaces for Forward.
 * Call at the original `railSurface` position (it owns a surface-forward effect).
 */
export function useRailNavigation({
  activeTabId,
  projectCwd,
  settingsOpen,
  searchViewOpen,
  inboxViewOpen,
  notesViewOpen,
  automationsViewOpen,
  setSettingsOpen,
  setSearchViewOpen,
  setInboxViewOpen,
  setNotesViewOpen,
  setAutomationsViewOpen,
  settingsReturnViewRef,
  onCloseSettings,
  onVisitBack,
  onVisitForward,
}: RailNavigationDeps): RailNavigation {
  const railSurface: RailSurface = {
    tabId: activeTabId,
    cwd: projectCwd,
    settings: settingsOpen,
    search: searchViewOpen,
    inbox: inboxViewOpen,
    notes: notesViewOpen,
    automations: automationsViewOpen,
  };
  const surfaceForward = useSurfaceForwardHistory(railSurface, (surface) => {
    setSettingsOpen(surface.settings);
    setSearchViewOpen(surface.search);
    setInboxViewOpen(surface.inbox);
    setNotesViewOpen(surface.notes && loadNotesEnabled());
    setAutomationsViewOpen(surface.automations);
  });

  const onRailBack = useCallback(() => {
    if (settingsOpen) {
      surfaceForward.remember({
        ...railSurface,
        ...settingsReturnViewRef.current,
        notes: settingsReturnViewRef.current.notes && loadNotesEnabled(),
        settings: false,
      });
      onCloseSettings();
      return;
    }
    if (searchViewOpen) {
      surfaceForward.remember({ ...railSurface, search: false });
      setSearchViewOpen(false);
      return;
    }
    if (inboxViewOpen) {
      surfaceForward.remember({ ...railSurface, inbox: false });
      setInboxViewOpen(false);
      return;
    }
    if (notesViewOpen) {
      surfaceForward.remember({ ...railSurface, notes: false });
      setNotesViewOpen(false);
      return;
    }
    if (automationsViewOpen) {
      surfaceForward.remember({ ...railSurface, automations: false });
      setAutomationsViewOpen(false);
      return;
    }
    onVisitBack();
  }, [
    onCloseSettings,
    onVisitBack,
    searchViewOpen,
    settingsOpen,
    inboxViewOpen,
    notesViewOpen,
    automationsViewOpen,
    surfaceForward,
    railSurface,
  ]);

  const onRailForward = useCallback(() => {
    if (surfaceForward.forward()) return;
    setSearchViewOpen(false);
    setSettingsOpen(false);
    setInboxViewOpen(false);
    setNotesViewOpen(false);
    setAutomationsViewOpen(false);
    onVisitForward();
  }, [onVisitForward, surfaceForward]);

  return { surfaceForward, onRailBack, onRailForward };
}
