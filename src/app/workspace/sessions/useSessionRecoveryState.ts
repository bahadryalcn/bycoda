import { useState, type Dispatch, type SetStateAction } from "react";
import {
  getSessionRecovery,
  type SessionRecovery,
} from "../../../features/workspace/model/sessionRecovery";
import type { SessionDeleteDialogState } from "../layout/WorkspaceDialogs";

export interface SessionRecoveryState {
  sessionRecovery: SessionRecovery | null;
  updateSessionRecovery: Dispatch<SetStateAction<SessionRecovery | null>>;
  recoveryOpen: boolean;
  setRecoveryOpen: Dispatch<SetStateAction<boolean>>;
  sessionDeleteDialog: SessionDeleteDialogState | undefined;
  setSessionDeleteDialog: Dispatch<SetStateAction<SessionDeleteDialogState | undefined>>;
}

/**
 * Recovery snapshot and the open/close and delete-dialog state around it. The
 * dialog starts closed: `useRecoveryAutoResolve` opens it after boot only when
 * interrupted work still needs attention.
 */
export function useSessionRecoveryState(): SessionRecoveryState {
  const [sessionRecovery, updateSessionRecovery] = useState(getSessionRecovery);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
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
