import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { projectDisplayName } from "../../projects/model/projectNames";
import { useT } from "../../../shared/i18n";
import { useState, useSyncExternalStore } from "react";
import { ToastSlot } from "../../../shared/ui/ToastRegion";
import {
  loadNotificationsEnabled,
  NOTIFICATIONS_CHANGE_EVENT,
} from "../../notifications/model/notifications";

import { sessionDisplayTitle } from "../model/session";
import { formatReminderTime, reminderTime, type SessionReminder } from "../model/sessionReminders";
import { ExplorerMenu } from "../../files/ui/ExplorerMenu";
import { Clock } from "../../../shared/ui/icons";
import { sessionReminderPresets } from "./sessionReminderPresets";

function subscribeNotifications(callback: () => void) {
  window.addEventListener(NOTIFICATIONS_CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(NOTIFICATIONS_CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function ReminderNotices({
  reminders,
  error,
  onOpen,
  onSnooze,
  onDismiss,
  onRetry,
  onOpenSettings,
}: {
  reminders: SessionReminder[];
  error: string | null;
  onOpen: (reminder: SessionReminder) => void;
  onSnooze: (ids: readonly string[], dueAt: number) => void;
  onDismiss: (ids: readonly string[], expectedDueAt?: number) => void;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const t = useT();
  const [snooze, setSnooze] = useState<{
    reminder: SessionReminder;
    x: number;
    y: number;
  } | null>(null);
  const notifications = useSyncExternalStore(subscribeNotifications, loadNotificationsEnabled);
  const visible = reminders.length > 0 || error != null;
  if (!visible) return null;

  return (
    <ToastSlot placement="top-end" order={-1}>
      <section
        aria-label={t("Due reminders")}
        className="relative flex w-[min(320px,calc(100vw-24px))] flex-col overflow-hidden rounded-(--ui-radius-popup) border border-(--ui-pane-border) bg-(--ui-surface-floating) text-(--ui-tone-neutral-fg) shadow-(--ui-elevation-floating)"
      >
        <div className="flex min-h-7 items-center gap-2 px-3 pt-2">
          <Clock className="icon-sm shrink-0 text-(--ui-text-secondary)" aria-hidden />
          <span className="flex-1 text-ui-caption font-medium text-(--ui-text-secondary)">
            {t("Due reminders")}
          </span>
          <span role="status" className="text-ui-caption tabular-nums text-(--ui-text-secondary)">
            {reminders.length || ""}
          </span>
        </div>
        {error ? (
          <div className="px-2 pt-1">
            <Alert
              inline
              tone="danger"
              role="alert"
              action={
                <Button variant="secondary" type="submit" onClick={onRetry}>
                  {t("Retry")}
                </Button>
              }
            >
              {t("Couldn’t load reminders.")}
            </Alert>
          </div>
        ) : null}
        <div className="flex max-h-[min(320px,50vh)] flex-col gap-1 overflow-y-auto overscroll-none p-1">
          {reminders.map((reminder) => (
            <article key={reminder.sessionId} className="rounded-(--ui-control-radius) px-2 py-1.5">
              <Button
                fullWidth
                variant="item"
                type="submit"
                className="block w-full text-left"
                onClick={() => onOpen(reminder)}
              >
                <span className="block truncate text-ui-secondary font-medium">
                  {sessionDisplayTitle(reminder.title, reminder.harness)}
                </span>
                <span
                  className="block truncate text-ui-caption text-(--ui-text-secondary)"
                  title={formatReminderTime(reminder.dueAt)}
                >
                  {projectDisplayName(reminder.cwd)} · {formatReminderTime(reminder.dueAt)}
                </span>
              </Button>
              <div className="mt-1 flex items-center gap-1">
                <Button variant="ghost" type="submit" onClick={() => onOpen(reminder)}>
                  {t("Open session")}
                </Button>
                <Button
                  variant="ghost"
                  type="submit"
                  aria-haspopup="menu"
                  aria-expanded={snooze?.reminder.sessionId === reminder.sessionId}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setSnooze({ reminder, x: rect.left, y: rect.bottom + 4 });
                  }}
                >
                  {t("Snooze")}
                </Button>
                <Button
                  variant="ghost"
                  type="submit"
                  className="ml-auto"
                  onClick={() => onDismiss([reminder.sessionId], reminder.dueAt)}
                >
                  {t("Dismiss")}
                </Button>
              </div>
            </article>
          ))}
        </div>
        {!notifications && reminders.length ? (
          <Button
            fullWidth
            variant="item"
            type="submit"
            className="w-full text-left"
            onClick={onOpenSettings}
          >
            {t("Desktop alerts are off. Enable in Settings.")}
          </Button>
        ) : null}
      </section>
      {snooze &&
      reminders.some(
        (reminder) =>
          reminder.sessionId === snooze.reminder.sessionId &&
          reminder.dueAt === snooze.reminder.dueAt,
      ) ? (
        <ExplorerMenu
          x={snooze.x}
          y={snooze.y}
          items={sessionReminderPresets()}
          ariaLabel="Snooze reminder"
          onClose={() => setSnooze(null)}
          onPick={(id) => {
            const dueAt = reminderTime(id);
            if (dueAt != null) onSnooze([snooze.reminder.sessionId], dueAt);
            setSnooze(null);
          }}
        />
      ) : null}
    </ToastSlot>
  );
}
