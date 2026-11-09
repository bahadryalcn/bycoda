import {
  NOTIFICATION_EVENTS,
  notificationEvent,
  type NotificationChannel,
  type NotificationEventKey,
  type NotificationSettings,
  type QuietHours,
} from "@bycoda/account-contracts";

/** Columns of the event by channel grid, in display order. */
export const NOTIFICATION_CHANNELS: readonly NotificationChannel[] = [
  "in_app",
  "os",
  "push",
  "email",
];

/** Events a person can configure (organization events appear when the catalog gets them). */
export function userNotificationEvents() {
  return NOTIFICATION_EVENTS.filter((event) => event.audience === "user");
}

/** The daily summary e-mail is one choice: the server's master `emailDigest` and its matrix cell. */
const isDigestCell = (event: NotificationEventKey, channel: NotificationChannel) =>
  event === "summary.daily" && channel === "email";

/** The server sends e-mail only for events that default to it and for the daily summary. */
export function isChannelApplicable(
  event: NotificationEventKey,
  channel: NotificationChannel,
): boolean {
  if (channel !== "email") return true;
  return isDigestCell(event, channel) || notificationEvent(event).defaultChannels.includes("email");
}

export function isChannelOn(
  settings: NotificationSettings,
  event: NotificationEventKey,
  channel: NotificationChannel,
): boolean {
  if (isDigestCell(event, channel)) return settings.emailDigest;
  return settings.preferences.some(
    (preference) =>
      preference.scope === "user" &&
      preference.event === event &&
      preference.channel === channel &&
      preference.enabled,
  );
}

/** Mandatory events (a sign-in from a new device) cannot be switched off. */
export function isLocked(event: NotificationEventKey): boolean {
  return notificationEvent(event).mandatory;
}

export function setChannel(
  settings: NotificationSettings,
  event: NotificationEventKey,
  channel: NotificationChannel,
  enabled: boolean,
): NotificationSettings {
  if (!enabled && isLocked(event)) return settings;
  if (isDigestCell(event, channel)) return setEmailDigest(settings, enabled);
  const others = settings.preferences.filter(
    (preference) =>
      !(
        preference.scope === "user" &&
        preference.event === event &&
        preference.channel === channel
      ),
  );
  return {
    ...settings,
    preferences: [...others, { scope: "user", event, channel, enabled }],
  };
}

/** A start equal to the end would silence everything, so it clears the quiet hours. */
export function setQuietHours(
  settings: NotificationSettings,
  quietHours: QuietHours | null,
): NotificationSettings {
  if (quietHours && quietHours.start === quietHours.end) return { ...settings, quietHours: null };
  return { ...settings, quietHours };
}

export function defaultQuietHours(timeZone: string): QuietHours {
  return { start: "22:00", end: "07:00", timeZone };
}

export function setPushDetails(
  settings: NotificationSettings,
  show: boolean,
): NotificationSettings {
  return { ...settings, pushShowDetails: show };
}

/** Turns the daily summary e-mail on or off and keeps the matrix cell in step with it. */
export function setEmailDigest(settings: NotificationSettings, on: boolean): NotificationSettings {
  const others = settings.preferences.filter(
    (preference) =>
      !(
        preference.scope === "user" &&
        preference.event === "summary.daily" &&
        preference.channel === "email"
      ),
  );
  return {
    ...settings,
    emailDigest: on,
    preferences: [
      ...others,
      { scope: "user", event: "summary.daily", channel: "email", enabled: on },
    ],
  };
}

/** An empty time field keeps the previous time. */
export function setDailySummaryTime(
  settings: NotificationSettings,
  time: string,
): NotificationSettings {
  return time ? { ...settings, dailySummaryTime: time } : settings;
}
