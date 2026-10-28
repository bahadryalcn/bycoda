import { useMemo, type Dispatch, type SetStateAction } from "react";
import { useSidebarActions } from "./useSidebarActions";
import { SessionRecoveryControl } from "../../shell/SessionRecoveryControl";
import type { ToolWindow } from "../../model/toolWindows";
import type { WindowTransferPayload } from "../../model/windowTransfer";

export interface RecoveryControlDeps {
  toolWindow: ToolWindow | null;
  windowTransfer: WindowTransferPayload | null;
  recoveryCount: number;
  editorDraftCount?: number;
  editorDraftAvailable?: boolean;
  setRecoveryOpen: Dispatch<SetStateAction<boolean>>;
  clearRecoveredSessions: () => Promise<void>;
}

export function useRecoveryControl({
  toolWindow,
  windowTransfer,
  recoveryCount,
  editorDraftCount = 0,
  editorDraftAvailable = false,
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
          count={recoveryCount + editorDraftCount}
          allowEmpty={editorDraftAvailable}
          includeFiles={editorDraftAvailable}
          onOpen={actions.onOpen}
          onClear={recoveryCount > 0 ? actions.onClear : undefined}
        />
      ) : null,
    [
      visible,
      recoveryCount,
      editorDraftCount,
      editorDraftAvailable,
      actions.onOpen,
      actions.onClear,
    ],
  );
}
