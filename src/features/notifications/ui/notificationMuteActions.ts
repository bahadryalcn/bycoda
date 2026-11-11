import { t } from "../../../shared/i18n";
import { notificationMuteLabel } from "./notificationMuteLabel";
import {
  isProjectMuted,
  NOTIFICATION_MUTE_HOURS,
  type ProjectNotificationPreference,
} from "../model/notificationPreferences";

/** A single status label for the project rail, menus, and mute controls. */
export function notificationMuteStatus(
  preference: ProjectNotificationPreference | undefined,
): string | null {
  if (!preference || !isProjectMuted(preference)) return null;
  return notificationMuteLabel(preference, t);
}

/** The same preset IDs and durations are used by project and Inbox menus. */
const mutePresets = [
  ...NOTIFICATION_MUTE_HOURS.map((hours) => ({
    kind: "item" as const,
    id: `mute:${hours}`,
    hours,
    milliseconds: hours * 3_600_000,
  })),
  {
    kind: "item" as const,
    id: "mute:indefinite",
    hours: 0,
    milliseconds: null,
  },
  { kind: "item" as const, id: "mute:custom", hours: 0 },
];

function presetLabel(id: string, hours: number): string {
  if (id === "mute:indefinite") return t("Until resumed");
  if (id === "mute:custom") return t("Choose date and time");
  return hours === 1 ? t("1 hour") : t("{p0} hours", { p0: hours });
}

export function notificationMuteActions(now = new Date(Date.now())) {
  return mutePresets.map(({ hours, ...action }) => {
    const label = presetLabel(action.id, hours);
    if (action.milliseconds == null) return { ...action, label };
    const until = new Date(now.getTime() + action.milliseconds);
    const time = `${until.getHours()}:${String(until.getMinutes()).padStart(2, "0")}`;
    const when =
      until.toDateString() === now.toDateString() ? time : t("Tomorrow, {p0}", { p0: time });
    return { ...action, label: t("{p0} ({p1})", { p0: label, p1: when }) };
  });
}

export function notificationMuteDeadline(id: string): number | null | undefined {
  const action = mutePresets.find((item) => item.id === id);
  if (!action || action.milliseconds === undefined) return undefined;
  return action.milliseconds === null ? null : Date.now() + action.milliseconds;
}
