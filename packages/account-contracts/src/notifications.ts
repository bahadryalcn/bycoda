import { z } from "zod";
import { ClockTime, EntityId, IanaTimeZone, IsoDateTime } from "./common.ts";

export const NOTIFICATION_EVENT_KEYS = [
  "account.new_device_sign_in",
  "agent.finished",
  "agent.failed",
  "approval.pending",
  "summary.daily",
  "announcement.published",
  "account.deletion_scheduled",
] as const;
export const NotificationEventKey = z.enum(NOTIFICATION_EVENT_KEYS);
export type NotificationEventKey = z.infer<typeof NotificationEventKey>;

export const NotificationChannel = z.enum(["in_app", "os", "push", "email"]);
export type NotificationChannel = z.infer<typeof NotificationChannel>;

export interface NotificationEventDefinition {
  key: NotificationEventKey;
  /** `organization` is reserved for the team plan; no such event exists yet. */
  audience: "user" | "organization";
  /** Mandatory events cannot be disabled by the user. */
  mandatory: boolean;
  defaultChannels: readonly NotificationChannel[];
}

/** Event catalog as data. Organization events are added later without changing the shape. */
export const NOTIFICATION_EVENTS: readonly NotificationEventDefinition[] = [
  {
    key: "account.new_device_sign_in",
    audience: "user",
    mandatory: true,
    defaultChannels: ["in_app", "email"],
  },
  { key: "agent.finished", audience: "user", mandatory: false, defaultChannels: ["os", "push"] },
  { key: "agent.failed", audience: "user", mandatory: false, defaultChannels: ["os", "push"] },
  { key: "approval.pending", audience: "user", mandatory: false, defaultChannels: ["os", "push"] },
  { key: "summary.daily", audience: "user", mandatory: false, defaultChannels: ["in_app"] },
  {
    key: "announcement.published",
    audience: "user",
    mandatory: false,
    defaultChannels: ["in_app"],
  },
  {
    key: "account.deletion_scheduled",
    audience: "user",
    mandatory: false,
    defaultChannels: ["in_app", "email"],
  },
];

export function notificationEvent(key: NotificationEventKey): NotificationEventDefinition {
  const found = NOTIFICATION_EVENTS.find((event) => event.key === key);
  if (!found) throw new Error(`Unknown notification event: ${key}`);
  return found;
}

export const NotificationPreference = z.strictObject({
  scope: z.enum(["user", "organization"]),
  event: NotificationEventKey,
  channel: NotificationChannel,
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof NotificationPreference>;

export const QuietHours = z.strictObject({
  start: ClockTime,
  end: ClockTime,
  timeZone: IanaTimeZone,
});
export type QuietHours = z.infer<typeof QuietHours>;

export const NotificationSettings = z
  .strictObject({
    preferences: z.array(NotificationPreference).max(200),
    quietHours: QuietHours.nullable(),
    dailySummaryTime: ClockTime.nullable(),
    /** Push text carries details only when the user opts in. */
    pushShowDetails: z.boolean().default(false),
    emailDigest: z.boolean().default(false),
  })
  .superRefine((settings, ctx) => {
    settings.preferences.forEach((preference, index) => {
      if (!preference.enabled && notificationEvent(preference.event).mandatory) {
        ctx.addIssue({
          code: "custom",
          path: ["preferences", index, "enabled"],
          message: `${preference.event} cannot be disabled`,
        });
      }
    });
  });
export type NotificationSettings = z.infer<typeof NotificationSettings>;

/** Settings a new account starts with: every default channel of every user event is enabled. */
export function defaultNotificationSettings(): NotificationSettings {
  const preferences: NotificationPreference[] = [];
  for (const event of NOTIFICATION_EVENTS) {
    if (event.audience !== "user") continue;
    for (const channel of event.defaultChannels) {
      preferences.push({ scope: "user", event: event.key, channel, enabled: true });
    }
  }
  return {
    preferences,
    quietHours: null,
    dailySummaryTime: "18:00",
    pushShowDetails: false,
    emailDigest: false,
  };
}

export const NotificationItem = z.object({
  id: EntityId,
  event: NotificationEventKey,
  title: z.string(),
  body: z.string(),
  createdAt: IsoDateTime,
  readAt: IsoDateTime.nullable(),
  /** The same logical event on several devices shares one key and is shown once. */
  dedupeKey: z.string(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;

export const NotificationFeedQuery = z.strictObject({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type NotificationFeedQuery = z.infer<typeof NotificationFeedQuery>;

export const NotificationFeed = z.object({
  items: z.array(NotificationItem),
  nextCursor: z.string().nullable(),
});
export type NotificationFeed = z.infer<typeof NotificationFeed>;

export const MarkRead = z.strictObject({ ids: z.array(EntityId).min(1).max(100) });
export type MarkRead = z.infer<typeof MarkRead>;

/** Events a desktop may report. Only the kind travels, never a session name, prompt or path. */
export const NOTIFICATION_REPORT_EVENTS = [
  "agent.finished",
  "agent.failed",
  "approval.pending",
] as const;

/** `POST /v1/notifications/events` body (response 204; stale or future-dated reports are ignored). */
export const NotificationEventReport = z.strictObject({
  event: z.enum(NOTIFICATION_REPORT_EVENTS),
  dedupeKey: z
    .string()
    .min(8)
    .max(100)
    .regex(/^[A-Za-z0-9._:-]+$/),
  occurredAt: IsoDateTime,
});
export type NotificationEventReport = z.infer<typeof NotificationEventReport>;
