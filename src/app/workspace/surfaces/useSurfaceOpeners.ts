import { startTransition, useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import { loadNotesEnabled } from "../../../features/settings/model/settings";
import { OPEN_USAGE_GUIDE_EVENT } from "../../../features/onboarding/model/usageGuide";

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
  }, [setServersViewOpen]);
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
  }, []);

  const onOpenNotes = useCallback(async (_routed = false) => {
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
  }, []);

  const onLeaveNotes = useCallback(() => {
    setNotesViewOpen(false);
  }, []);

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
  }, []);

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
    return () => window.removeEventListener(OPEN_USAGE_GUIDE_EVENT, revealWorkspace);
  }, []);

  return {
    onOpenServers,
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
