import { startTransition, useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import { loadNotesEnabled } from "../../../features/settings/model/settings";
import { OPEN_USAGE_GUIDE_EVENT } from "../../../features/onboarding/model/usageGuide";
import { revealExistingTool } from "../helpers/appHelpers";

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
// tasks). Each opener first tries to reveal an existing tool window for the
// project unless the call was routed from another window.
export function useSurfaceOpeners({
  projectCwd,
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
  const onOpenInbox = useCallback(
    async (routed = false) => {
      if (routed !== true && (await revealExistingTool("inbox", projectCwd))) return;
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
    },
    [projectCwd],
  );

  const onLeaveInbox = useCallback(() => {
    setInboxViewOpen(false);
  }, []);

  const onOpenNotes = useCallback(
    async (routed = false) => {
      if (!loadNotesEnabled()) return;
      if (routed !== true && (await revealExistingTool("notes", projectCwd))) return;
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
    [projectCwd],
  );

  const onLeaveNotes = useCallback(() => {
    setNotesViewOpen(false);
  }, []);

  const onOpenAutomations = useCallback(
    async (routed = false) => {
      if (routed !== true && (await revealExistingTool("automations", projectCwd))) return;
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
    },
    [projectCwd],
  );

  const onOpenTasks = useCallback(
    async (routed = false) => {
      if (routed !== true && (await revealExistingTool("tasks", projectCwd))) return;
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
    },
    [projectCwd],
  );

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
