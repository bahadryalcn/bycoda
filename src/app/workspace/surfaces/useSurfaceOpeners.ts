import { startTransition, useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import { loadNotesEnabled } from "../../../features/settings/model/settings";
import { OPEN_NOTE_LIBRARY_EVENT } from "../../../features/notes/noteNavigation";
import { OPEN_CREWS_PAGE_EVENT, setCrewsPageOpen } from "../../../features/crews/model/crewsPage";
import { OPEN_USAGE_GUIDE_EVENT } from "../../../features/onboarding/model/usageGuide";
import { START_TOUR_EVENT } from "../../../features/onboarding/model/tourState";

export interface SurfaceOpenersDeps {
  projectCwd: string;
  setFilePickerOpen: Dispatch<SetStateAction<boolean>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setSearchViewOpen: Dispatch<SetStateAction<boolean>>;
  setInboxViewOpen: Dispatch<SetStateAction<boolean>>;
  setNotesViewOpen: Dispatch<SetStateAction<boolean>>;
  setAutomationsViewOpen: Dispatch<SetStateAction<boolean>>;
  setTaskBoardShown: Dispatch<SetStateAction<boolean>>;
  setSocialBoardShown: Dispatch<SetStateAction<boolean>>;
  setPullRequestsOnly: Dispatch<SetStateAction<boolean>>;
  setServersViewOpen?: Dispatch<SetStateAction<boolean>>;
}

// Opens and leaves the workspace tool surfaces (inbox, notes, automations,
// tasks) in the current window. Cross-window routing belongs to explicit pop-outs.
export function useSurfaceOpeners({
  setFilePickerOpen,
  setSettingsOpen,
  setSearchViewOpen,
  setInboxViewOpen,
  setNotesViewOpen,
  setAutomationsViewOpen,
  setTaskBoardShown,
  setSocialBoardShown,
  setPullRequestsOnly,
  setServersViewOpen,
}: SurfaceOpenersDeps) {
  const onOpenServers = useCallback(() => {
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setServersViewOpen?.(true);
    });
  }, [
    setServersViewOpen,
    setAutomationsViewOpen,
    setSearchViewOpen,
    setSettingsOpen,
    setInboxViewOpen,
    setFilePickerOpen,
    setNotesViewOpen,
  ]);
  const onOpenCrews = useCallback(() => {
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      // Closing Servers also closes Crews, so it comes first.
      setServersViewOpen?.(false);
      setCrewsPageOpen(true);
    });
  }, [
    setFilePickerOpen,
    setSettingsOpen,
    setSearchViewOpen,
    setInboxViewOpen,
    setNotesViewOpen,
    setAutomationsViewOpen,
    setServersViewOpen,
  ]);
  useEffect(() => {
    window.addEventListener(OPEN_CREWS_PAGE_EVENT, onOpenCrews);
    return () => window.removeEventListener(OPEN_CREWS_PAGE_EVENT, onOpenCrews);
  }, [onOpenCrews]);
  const onLeaveServers = useCallback(() => setServersViewOpen?.(false), [setServersViewOpen]);
  const onOpenInbox = useCallback(async (_routed = false) => {
    setPullRequestsOnly(false);
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setServersViewOpen?.(false);
      setInboxViewOpen(true);
    });
  }, []);

  const onLeaveInbox = useCallback(() => {
    setInboxViewOpen(false);
  }, [setInboxViewOpen]);

  const onOpenNotes = useCallback(
    async (_routed = false) => {
      if (!loadNotesEnabled()) return;
      startTransition(() => {
        setFilePickerOpen(false);
        setSettingsOpen(false);
        setSearchViewOpen(false);
        setInboxViewOpen(false);
        setAutomationsViewOpen(false);
        setServersViewOpen?.(false);
        setNotesViewOpen(true);
      });
    },
    [
      setServersViewOpen,
      setAutomationsViewOpen,
      setSearchViewOpen,
      setSettingsOpen,
      setInboxViewOpen,
      setFilePickerOpen,
      setNotesViewOpen,
    ],
  );

  const onLeaveNotes = useCallback(() => {
    setNotesViewOpen(false);
  }, [setNotesViewOpen]);

  useEffect(() => {
    const open = () => {
      void onOpenNotes(true);
    };
    window.addEventListener(OPEN_NOTE_LIBRARY_EVENT, open);
    return () => window.removeEventListener(OPEN_NOTE_LIBRARY_EVENT, open);
  }, [onOpenNotes]);

  const onOpenAutomations = useCallback(async (_routed = false) => {
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setTaskBoardShown(false);
      setSocialBoardShown(false);
      setAutomationsViewOpen(true);
      setServersViewOpen?.(false);
    });
  }, []);

  const onOpenTasks = useCallback(async (_routed = false) => {
    startTransition(() => {
      setFilePickerOpen(false);
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setSocialBoardShown(false);
      setTaskBoardShown(true);
      setAutomationsViewOpen(true);
      setServersViewOpen?.(false);
    });
  }, []);

  const onLeaveAutomations = useCallback(() => {
    setAutomationsViewOpen(false);
  }, [setAutomationsViewOpen]);

  // Usage guide reveals the workspace: close every tool surface and settings.
  useEffect(() => {
    const revealWorkspace = () => {
      setSettingsOpen(false);
      setSearchViewOpen(false);
      setInboxViewOpen(false);
      setNotesViewOpen(false);
      setAutomationsViewOpen(false);
      setServersViewOpen?.(false);
    };
    window.addEventListener(OPEN_USAGE_GUIDE_EVENT, revealWorkspace);
    // A guided tour points at the workspace controls too.
    window.addEventListener(START_TOUR_EVENT, revealWorkspace);
    return () => {
      window.removeEventListener(OPEN_USAGE_GUIDE_EVENT, revealWorkspace);
      window.removeEventListener(START_TOUR_EVENT, revealWorkspace);
    };
  }, [
    setServersViewOpen,
    setAutomationsViewOpen,
    setSearchViewOpen,
    setInboxViewOpen,
    setSettingsOpen,
    setNotesViewOpen,
  ]);

  return {
    onOpenServers,
    onOpenCrews,
    onLeaveServers,
    onOpenInbox,
    onLeaveInbox,
    onOpenNotes,
    onLeaveNotes,
    onOpenAutomations,
    onOpenTasks,
    onLeaveAutomations,
  };
}
