import type { ExplorerMenuItem } from "../../files";
import type { BoundFormat, t } from "../../../shared/i18n";
import { reminderTime } from "../model/sessionReminders";

/**
 * Snooze choices with translated labels and clock times in the app language and the locale's
 * own hour cycle, the same as the reminder time shown in the notice. Scheduling stays in
 * `reminderTime`; this only labels its results.
 */
export function sessionReminderPresets(
  translate: typeof t,
  formatDate: BoundFormat["formatDate"],
  now = new Date(),
) {
  const clock = (value: Date | number, options?: Intl.DateTimeFormatOptions) =>
    formatDate(value, { hour: "numeric", minute: "2-digit", ...options });
  const dueAt = (preset: string) => new Date(reminderTime(preset, now)!);
  const evening = new Date(now);
  evening.setHours(18, 0, 0, 0);

  return [
    {
      kind: "item",
      id: "reminder:1h",
      label: translate("In 1 hour ({p0})", { p0: clock(dueAt("reminder:1h")) }),
    },
    {
      kind: "item",
      id: "reminder:3h",
      label: translate("In 3 hours ({p0})", { p0: clock(dueAt("reminder:3h")) }),
    },
    {
      kind: "item",
      id: "reminder:evening",
      label: translate("This evening ({p0})", { p0: clock(evening) }),
      disabled: reminderTime("reminder:evening", now) == null,
    },
    {
      kind: "item",
      id: "reminder:tomorrow",
      label: translate("Tomorrow ({p0})", { p0: clock(dueAt("reminder:tomorrow")) }),
    },
    {
      kind: "item",
      id: "reminder:next-week",
      label: translate("Next week ({p0})", {
        p0: clock(dueAt("reminder:next-week"), { weekday: "short" }),
      }),
    },
  ] satisfies ExplorerMenuItem[];
}
