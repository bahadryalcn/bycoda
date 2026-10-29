import { startTransition, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { SOCIAL_PANEL_EVENT } from "../../../features/social/ui/SocialShortcut";
import {
  OPEN_REMOTE_PROJECT_EVENT,
  REMOTE_HISTORY_UPDATED,
  REMOTE_TAB_BINDING_CHANGE,
} from "../../../features/connections/model/connections";

type SetFlag = Dispatch<SetStateAction<boolean>>;

export interface AppWindowEventsDeps {
  setFilePickerOpen: SetFlag;
  setSettingsOpen: SetFlag;
  setSearchViewOpen: SetFlag;
  setInboxViewOpen: SetFlag;
  setServersViewOpen: SetFlag;
  setNotesViewOpen: SetFlag;
  setSocialPanelCwd: (cwd: string) => void;
  setSocialBoardShown: SetFlag;
  setTaskBoardShown: SetFlag;
  setAutomationsViewOpen: SetFlag;
}

/**
 * App-level `window` event subscriptions: the social panel shortcut, remote tab
 * title refreshes, remote tab binding changes and the open-remote-project
 * request. Each keeps its own mount-only subscription and cleanup. The state the
 * remote events drive lives here and is returned for the callers that read it.
 */
export function useAppWindowEvents({
  setFilePickerOpen,
  setSettingsOpen,
  setSearchViewOpen,
  setInboxViewOpen,
  setServersViewOpen,
  setNotesViewOpen,
  setSocialPanelCwd,
  setSocialBoardShown,
  setTaskBoardShown,
  setAutomationsViewOpen,
}: AppWindowEventsDeps): {
  remoteBindingRevision: number;
  remoteProjectDialogOpen: boolean;
  setRemoteProjectDialogOpen: SetFlag;
} {
  useEffect(() => {
    const open = async (event: Event) => {
      const detail = (event as CustomEvent<{ cwd: string; local?: boolean }>).detail;
      startTransition(() => {
        setFilePickerOpen(false);
        setSettingsOpen(false);
        setSearchViewOpen(false);
        setInboxViewOpen(false);
        setServersViewOpen(false);
        setNotesViewOpen(false);
        setSocialPanelCwd(detail.cwd);
        setSocialBoardShown(true);
        setTaskBoardShown(false);
        setAutomationsViewOpen(true);
      });
    };
    window.addEventListener(SOCIAL_PANEL_EVENT, open);
    return () => window.removeEventListener(SOCIAL_PANEL_EVENT, open);
  }, []);

  const [, refreshRemoteTabTitles] = useState(0);
  useEffect(() => {
    const updated = () => refreshRemoteTabTitles((value) => value + 1);
    window.addEventListener(REMOTE_HISTORY_UPDATED, updated);
    return () => window.removeEventListener(REMOTE_HISTORY_UPDATED, updated);
  }, []);

  const [remoteBindingRevision, setRemoteBindingRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRemoteBindingRevision((revision) => revision + 1);
    window.addEventListener(REMOTE_TAB_BINDING_CHANGE, changed);
    return () => window.removeEventListener(REMOTE_TAB_BINDING_CHANGE, changed);
  }, []);

  const [remoteProjectDialogOpen, setRemoteProjectDialogOpen] = useState(false);
  useEffect(() => {
    const open = () => setRemoteProjectDialogOpen(true);
    window.addEventListener(OPEN_REMOTE_PROJECT_EVENT, open);
    return () => window.removeEventListener(OPEN_REMOTE_PROJECT_EVENT, open);
  }, []);

  return { remoteBindingRevision, remoteProjectDialogOpen, setRemoteProjectDialogOpen };
}
