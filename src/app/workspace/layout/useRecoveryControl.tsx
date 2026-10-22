import { useMemo, type Dispatch, type SetStateAction } from "react";
import { useSidebarActions } from "./useSidebarActions";
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
  const actions = useSidebarActions({
    onOpen: () => setRecoveryOpen(true),
    onClear: clearRecoveredSessions,
  });
  const visible = !toolWindow && !windowTransfer;
  return useMemo(
    () =>
      visible ? (
        <SessionRecoveryControl
          count={recoveryCount}
          onOpen={actions.onOpen}
          onClear={actions.onClear}
        />
      ) : null,
    [visible, recoveryCount, actions.onOpen, actions.onClear],
  );
}
