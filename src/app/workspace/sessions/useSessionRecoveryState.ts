import { useState, type Dispatch, type SetStateAction } from "react";
import {
  getSessionRecovery,
  type SessionRecovery,
} from "../../../features/workspace/model/sessionRecovery";
import type { SessionDeleteDialogState } from "../layout/WorkspaceDialogs";
import type { WindowTransferPayload } from "../../model/windowTransfer";
import type { ToolWindow } from "../../model/toolWindows";

export interface SessionRecoveryStateDeps {
  windowTransfer: WindowTransferPayload | null;
  toolWindow: ToolWindow | null;
}

export interface SessionRecoveryState {
  sessionRecovery: SessionRecovery | null;
  updateSessionRecovery: Dispatch<SetStateAction<SessionRecovery | null>>;
  recoveryOpen: boolean;
  setRecoveryOpen: Dispatch<SetStateAction<boolean>>;
  sessionDeleteDialog: SessionDeleteDialogState | undefined;
  setSessionDeleteDialog: Dispatch<SetStateAction<SessionDeleteDialogState | undefined>>;
}

/** Recovery snapshot and the open/close and delete-dialog state around it. */
export function useSessionRecoveryState({
  windowTransfer,
  toolWindow,
}: SessionRecoveryStateDeps): SessionRecoveryState {
  const [sessionRecovery, updateSessionRecovery] = useState(getSessionRecovery);
  const [recoveryOpen, setRecoveryOpen] = useState(
    () =>
      !windowTransfer && !toolWindow && !!getSessionRecovery() && !getSessionRecovery()?.dismissed,
  );
  const [sessionDeleteDialog, setSessionDeleteDialog] = useState<SessionDeleteDialogState>();
  return {
    sessionRecovery,
    updateSessionRecovery,
    recoveryOpen,
    setRecoveryOpen,
    sessionDeleteDialog,
    setSessionDeleteDialog,
  };
}
