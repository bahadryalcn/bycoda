import { createElement, type ReactNode } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { ConfirmDialog, type ConfirmRequest } from "../../../shared/ui/ConfirmDialog";

/**
 * Renders the shared confirmation for a dialog-style component whose parent owns open/close
 * state. The dialog mounts in tree order (not after a deferred open), so a dialog stacked on
 * top of it keeps Escape, and dismissal reaches the owner synchronously. Confirmation work
 * runs through `request.onConfirm`; the owner closes the dialog afterwards as before.
 */
export function useProjectConfirmDialog(request: ConfirmRequest, onCancel: () => void): ReactNode {
  const cancel = useStableCallback(onCancel);
  return createElement(ConfirmDialog, {
    request,
    onSettle: (value: boolean) => {
      if (!value) cancel();
    },
  });
}
