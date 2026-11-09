import { useMemo } from "react";
import { useStableValue } from "../../../shared/hooks/useStableValue";
import { sameShallowItems } from "../helpers/stableProps";
import {
  hiddenApprovalNotices,
  pendingApprovalNotices,
} from "../../../features/notifications/model/approvalToast";

export interface WorkspaceNotificationDeps {
  sessions: Parameters<typeof hiddenApprovalNotices>[0];
  activeTabId: Parameters<typeof hiddenApprovalNotices>[1];
  tabs: Parameters<typeof hiddenApprovalNotices>[2];
  composerFocused: Parameters<typeof hiddenApprovalNotices>[3];
}

/** Approval toasts hidden from the current view, and the pending approval notices list. */
export function useWorkspaceNotifications({
  sessions,
  activeTabId,
  tabs,
  composerFocused,
}: WorkspaceNotificationDeps) {
  // Rebuilt on every shell change; kept while the notices themselves are the same,
  // so the footer's toasts do not re-render for unrelated session updates.
  const hiddenApprovalToasts = useStableValue(
    useMemo(
      () => hiddenApprovalNotices(sessions, activeTabId, tabs, composerFocused),
      [sessions, activeTabId, tabs, composerFocused],
    ),
    sameShallowItems,
  );
  const pendingNotifications = useStableValue(
    useMemo(() => pendingApprovalNotices(sessions), [sessions]),
    sameShallowItems,
  );
  return { hiddenApprovalToasts, pendingNotifications };
}
