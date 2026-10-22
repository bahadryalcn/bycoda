import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { projectDisplayName } from "../../projects/model/projectNames";
import { t, useLocale } from "../../../shared/i18n";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { LAYER } from "../../../shared/lib/layers";
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
  onHeightChange,
}: {
  reminders: SessionReminder[];
  error: string | null;
  onOpen: (reminder: SessionReminder) => void;
  onSnooze: (ids: readonly string[], dueAt: number) => void;
  onDismiss: (ids: readonly string[], expectedDueAt?: number) => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  onHeightChange?: (height: number) => void;
}) {
  useLocale();
  const panelRef = useRef<HTMLElement>(null);
  const [snooze, setSnooze] = useState<{
    reminder: SessionReminder;
    x: number;
    y: number;
  } | null>(null);
  const notifications = useSyncExternalStore(subscribeNotifications, loadNotificationsEnabled);
  const visible = reminders.length > 0 || error != null;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !onHeightChange) return;
    const measure = () => onHeightChange(panel.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => {
      observer.disconnect();
      onHeightChange(0);
    };
  }, [visible, onHeightChange]);
  if (!visible) return null;

  return createPortal(
    <>
      <section
        ref={panelRef}
        aria-label={t("Due reminders")}
        style={{ zIndex: LAYER.popover - 1 }}
        className="fixed top-3 right-3 w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-xl border border-(--ui-tone-neutral-border) bg-(--ui-surface) text-(--ui-tone-neutral-fg) shadow-xl backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 border-b border-(--ui-tone-neutral-border) px-3 py-2.5">
          <Clock className="size-3.5 text-(--ui-tone-warning-fg)" strokeWidth={1.75} />
          <span className="flex-1 text-[12px] font-semibold">{t("Due reminders")}</span>
          <span role="status" className="text-[11px] text-(--ui-text-secondary)">
            {reminders.length || ""}
          </span>
        </div>
        {error ? (
          <Alert tone="info" role="alert">
            {t("Couldn’t load reminders.")}{" "}
            <Button variant="ghost" type="submit" onClick={onRetry}>
              {t("Retry")}
            </Button>
          </Alert>
        ) : null}
        <div className="max-h-[min(320px,50vh)] overflow-y-auto overscroll-none divide-y divide-stroke">
          {reminders.map((reminder) => (
            <article key={reminder.sessionId} className="px-3 py-2.5">
              <Button
                fullWidth
                variant="item"
                type="submit"
                className="block w-full text-left"
                onClick={() => onOpen(reminder)}
              >
                <span className="block truncate text-[13px] font-medium hover:underline">
                  {sessionDisplayTitle(reminder.title, reminder.harness)}
                </span>
                <span
                  className="mt-1 block truncate text-[11px] text-(--ui-text-secondary)"
                  title={formatReminderTime(reminder.dueAt)}
                >
                  {projectDisplayName(reminder.cwd)} · {formatReminderTime(reminder.dueAt)}
                </span>
              </Button>
              <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                <Button
                  variant="ghost"
                  type="submit"

                  onClick={() => onOpen(reminder)}
                >
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
    </>,
    document.body,
  );
}
