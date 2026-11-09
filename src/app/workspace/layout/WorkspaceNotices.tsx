import { AnnouncementNotices, FeedbackDialog, StatsConsentNotice } from "../../../features/account";
import { CrashReportNotice } from "../../../features/diagnostics";
import { PhoneAccountConnect } from "../../../features/connections/ui/PhoneAccountConnect";
import { ContributePrompt } from "../../../features/projects/ui/ContributePrompt";
import { HarnessUpdateNotice } from "../../../features/providers/ui/HarnessUpdateNotice";
import { ReminderNotices } from "../../../features/sessions/ui/ReminderNotices";
import { SyncMergedNotice } from "../../../features/sync/ui/SyncMergedNotice";
import type { useSessionReminders } from "../../../features/notifications/hooks/useSessionReminders";
import type { SettingsAnchor } from "../../../features/settings/ui/SettingsView";
import type { SettingsSectionId } from "../../../features/settings/model/settings";
import { ToastRegion } from "../../../shared/ui/ToastRegion";
import { WindowTransferNotice } from "../windows/WindowTransferNotice";

export interface WorkspaceNoticesProps {
  sessionReminders: ReturnType<typeof useSessionReminders>;
  openSettings: (section?: SettingsSectionId, anchor?: SettingsAnchor) => void;
}

export function WorkspaceNotices({ sessionReminders, openSettings }: WorkspaceNoticesProps) {
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
        onOpenSettings={() => openSettings("notifications", "notifications")}
      />
      <StatsConsentNotice />
      <CrashReportNotice />
      <AnnouncementNotices />
      <FeedbackDialog />
      <PhoneAccountConnect />
      <ContributePrompt />
      <SyncMergedNotice />
      <WindowTransferNotice />
      <ToastRegion insets={{ "top-end": 48 }} />
    </>
  );
}
