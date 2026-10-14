import type { Dispatch, SetStateAction } from "react";
import { SessionRecoveryControl } from "../../shell/SessionRecoveryControl";
import type { ToolWindow } from "../../model/toolWindows";
import type { WindowTransferPayload } from "../../model/windowTransfer";

export interface RecoveryControlDeps {
  toolWindow: ToolWindow | null;
  windowTransfer: WindowTransferPayload | null;
  recoveryCount: number;
  setRecoveryOpen: Dispatch<SetStateAction<boolean>>;
  clearRecoveredSessions: () => Promise<void>;
}

export function useRecoveryControl({
  toolWindow,
  windowTransfer,
  recoveryCount,
  setRecoveryOpen,
  clearRecoveredSessions,
}: RecoveryControlDeps) {
  return !toolWindow && !windowTransfer ? (
    <SessionRecoveryControl
      count={recoveryCount}
      onOpen={() => setRecoveryOpen(true)}
      onClear={clearRecoveredSessions}
    />
  ) : null;
}
