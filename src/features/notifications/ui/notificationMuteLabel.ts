import type { t } from "../../../shared/i18n";
import type { ProjectNotificationPreference } from "../model/notificationPreferences";

/** The label of a preference already known to be muted, with the translator given so render reads no clock or locale. */
export function notificationMuteLabel(
  preference: ProjectNotificationPreference,
  translate: typeof t,
): string {
  return preference.mutedUntil === null
    ? translate("Muted until resumed")
    : translate("Muted until {p0}", {
        p0: new Date(preference.mutedUntil!).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      });
}
