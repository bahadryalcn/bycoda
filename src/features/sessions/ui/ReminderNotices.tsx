import { Button } from "../../../shared/ui/Button";
import { projectDisplayNameFrom, useProjectLabels } from "../../projects/public/projectNames";
import { useFormat, useT } from "../../../shared/i18n";
import { useState } from "react";
import { ToastSlot } from "../../../shared/ui/ToastRegion";
import { sessionDisplayTitle } from "../model/session";
import {
  formatReminderTimeWith,
  reminderTime,
  type SessionReminder,
} from "../model/sessionReminders";
import { ExplorerMenu } from "../../files/public/ExplorerMenu";
import { Clock } from "../../../shared/ui/icons";
import { sessionReminderPresets } from "./sessionReminderPresets";
import { NoticeActionButton, TranscriptNotice } from "./TranscriptNotice";

export function ReminderNotices({
  reminders,
  error,
  onOpen,
  onSnooze,
  onDismiss,
  onRetry,
}: {
  reminders: SessionReminder[];
  error: string | null;
  onOpen: (reminder: SessionReminder) => void;
  onSnooze: (ids: readonly string[], dueAt: number) => void;
  onDismiss: (ids: readonly string[], expectedDueAt?: number) => void;
  onRetry: () => void;
  /** Retired: the notifications-off footer lives in Settings only; callers may stop passing it. */
  onOpenSettings?: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const projectLabels = useProjectLabels();
  const [snooze, setSnooze] = useState<{
    reminder: SessionReminder;
    x: number;
    y: number;
    /** The snooze choices with their clock times, fixed when the menu opens. */
    presets: ReturnType<typeof sessionReminderPresets>;
  } | null>(null);
  const visible = reminders.length > 0 || error != null;
  if (!visible) return null;

  return (
    <ToastSlot order={-1}>
      <section
        aria-label={t("Due reminders")}
        className="relative flex max-h-[min(360px,60vh)] w-[min(360px,calc(100vw-24px))] flex-col gap-1.5 overflow-y-auto overscroll-none"
      >
        {error ? (
          <TranscriptNotice
            elevated
            kind="error"
            title={t("Couldn’t load reminders.")}
            actions={<NoticeActionButton action={{ label: t("Try again"), onClick: onRetry }} />}
          />
        ) : null}
        {reminders.map((reminder) => (
          <TranscriptNotice
            key={reminder.sessionId}
            elevated
            kind="info"
            icon={<Clock className="icon-md" aria-hidden />}
            title={sessionDisplayTitle(reminder.title, reminder.harness)}
            detail={`${projectDisplayNameFrom(reminder.cwd, projectLabels)} · ${formatReminderTimeWith(reminder.dueAt, format.formatDate)}`}
            onDismiss={() => onDismiss([reminder.sessionId], reminder.dueAt)}
            actions={
              <>
                <NoticeActionButton
                  action={{ label: t("Open"), onClick: () => onOpen(reminder) }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={snooze?.reminder.sessionId === reminder.sessionId}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setSnooze({
                      reminder,
                      x: rect.left,
                      y: rect.bottom + 4,
                      presets: sessionReminderPresets(t, format.formatDate),
                    });
                  }}
                >
                  {t("Snooze")}
                </Button>
              </>
            }
          />
        ))}
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
          items={snooze.presets}
          ariaLabel={t("Snooze reminder")}
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
