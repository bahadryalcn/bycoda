import type { Dispatch, SetStateAction } from "react";
import { HarnessUpdateNotice } from "../../../features/providers/ui/HarnessUpdateNotice";
import { ReminderNotices } from "../../../features/sessions/ui/ReminderNotices";
import { SyncMergedNotice } from "../../../features/sync/ui/SyncMergedNotice";
import type { useSessionReminders } from "../../../features/notifications/hooks/useSessionReminders";
import type { SettingsAnchor } from "../../../features/settings/ui/SettingsView";
import type { SettingsSectionId } from "../../../features/settings/model/settings";

export interface WorkspaceNoticesProps {
  setHarnessUpdateHeight: Dispatch<SetStateAction<number>>;
  reminderNoticesHeight: number;
  setReminderNoticesHeight: Dispatch<SetStateAction<number>>;
  sessionReminders: ReturnType<typeof useSessionReminders>;
  openSettings: (section?: SettingsSectionId, anchor?: SettingsAnchor) => void;
}

export function WorkspaceNotices({
  setHarnessUpdateHeight,
  reminderNoticesHeight,
  setReminderNoticesHeight,
  sessionReminders,
  openSettings,
}: WorkspaceNoticesProps) {
  return (
    <>
      <HarnessUpdateNotice
        topOffset={12 + (reminderNoticesHeight ? reminderNoticesHeight + 8 : 0)}
        onHeightChange={setHarnessUpdateHeight}
      />
      <ReminderNotices
        reminders={sessionReminders.due}
        error={sessionReminders.error}
        onOpen={sessionReminders.open}
        onSnooze={sessionReminders.schedule}
        onDismiss={sessionReminders.cancel}
        onRetry={sessionReminders.refresh}
        onOpenSettings={() => openSettings("notifications", "notifications")}
        onHeightChange={setReminderNoticesHeight}
      />
      <SyncMergedNotice />
    </>
  );
}
