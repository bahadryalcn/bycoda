import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { InlineError } from "../../../shared/ui/InlineError";
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
import { Clock, X } from "../../../shared/ui/icons";
import { sessionReminderPresets } from "./sessionReminderPresets";

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
      <Text
        as="section"
        size="inherit"
        tone="neutral"
        aria-label={t("Due reminders")}
        {...surfaceAttributes(
          { frame: "pane", variant: "floating" },
          "relative flex w-[min(320px,calc(100vw-24px))] flex-col overflow-hidden rounded-(--ui-radius-popup) shadow-(--ui-elevation-floating)",
        )}
      >
        {error ? (
          <div className="px-2 pt-1">
            <InlineError retry={{ onRetry }}>{t("Couldn’t load reminders.")}</InlineError>
          </div>
        ) : null}
        <div className="flex max-h-[min(320px,50vh)] flex-col gap-1 overflow-y-auto overscroll-none p-1">
          {reminders.map((reminder) => (
            <article key={reminder.sessionId} className="flex items-center gap-1 px-1 py-0.5">
              <Button
                variant="item"
                type="button"
                className="min-w-0 flex-1 text-start"
                onClick={() => onOpen(reminder)}
              >
                <Text
                  as="span"
                  size="secondary"
                  tone="inherit"
                  weight="medium"
                  truncate
                  className="block"
                >
                  {sessionDisplayTitle(reminder.title, reminder.harness)}
                </Text>
                <Text as="span" size="caption" tone="secondary" truncate className="block">
                  {projectDisplayNameFrom(reminder.cwd, projectLabels)} ·{" "}
                  {formatReminderTimeWith(reminder.dueAt, format.formatDate)}
                </Text>
              </Button>
              <Button
                variant="ghost"
                type="button"
                iconOnly
                label={t("Snooze")}
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
                <Clock className="icon-sm" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                type="button"
                iconOnly
                label={t("Dismiss")}
                onClick={() => onDismiss([reminder.sessionId], reminder.dueAt)}
              >
                <X className="icon-sm" aria-hidden />
              </Button>
            </article>
          ))}
        </div>
      </Text>
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
