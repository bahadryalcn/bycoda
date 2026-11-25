import { AnnouncementNotices, FeedbackDialog, StatsConsentNotice } from "../../../features/account";
import { CrashReportNotice } from "../../../features/diagnostics";
import { DataSharingNotices } from "../../../features/data-sharing";
import { PhoneAccountConnect } from "../../../features/connections/ui/PhoneAccountConnect";
import { ContributePrompt } from "../../../features/projects/ui/ContributePrompt";
import { HarnessUpdateNotice } from "../../../features/providers/ui/HarnessUpdateNotice";
import { ReminderNotices } from "../../../features/sessions/ui/ReminderNotices";
import type { useSessionReminders } from "../../../features/notifications/hooks/useSessionReminders";
import { PolicyUpdateNotice } from "../../../features/settings/ui/PolicyUpdateNotice";
import { ToastRegion } from "../../../shared/ui/ToastRegion";
import { logToastAnnouncement } from "../../../features/notifications/model/notificationLog";
import { WindowTransferNotice } from "../windows/WindowTransferNotice";

export interface WorkspaceNoticesProps {
  sessionReminders: ReturnType<typeof useSessionReminders>;
}

export function WorkspaceNotices({ sessionReminders }: WorkspaceNoticesProps) {
  return (
    <>
      <HarnessUpdateNotice />
      <ReminderNotices
        reminders={sessionReminders.due}
        error={sessionReminders.error}
        onOpen={sessionReminders.open}
        onSnooze={sessionReminders.schedule}
        onDismiss={sessionReminders.cancel}
        onRetry={sessionReminders.refresh}
      />
      <StatsConsentNotice />
      <CrashReportNotice />
      <DataSharingNotices />
      <AnnouncementNotices />
      <PolicyUpdateNotice />
      <FeedbackDialog />
      <PhoneAccountConnect />
      <ContributePrompt />
      <WindowTransferNotice />
      <ToastRegion onRecord={logToastAnnouncement} insets={{ "top-center": 48, "top-end": 48 }} />
    </>
  );
}
