import { useMemo } from "react";
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
  const hiddenApprovalToasts = useMemo(
    () => hiddenApprovalNotices(sessions, activeTabId, tabs, composerFocused),
    [sessions, activeTabId, tabs, composerFocused],
  );
  const pendingNotifications = useMemo(() => pendingApprovalNotices(sessions), [sessions]);
  return { hiddenApprovalToasts, pendingNotifications };
}
