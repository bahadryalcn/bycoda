import {
  notificationEvent,
  type NotificationEventKey,
  type NotificationItem,
  type NotificationSettings,
} from "@bycoda/account-contracts";
import { inQuietHours } from "./quietHours";

/** Server items older than this are never shown as a banner. */
export const FEED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Events this desktop raises itself; the server copy exists for the phone and other devices. */
const RAISED_LOCALLY: ReadonlySet<NotificationEventKey> = new Set([
  "agent.finished",
  "agent.failed",
  "approval.pending",
]);

export type FeedContext = {
  settings: NotificationSettings;
  now: number;
  /** Dedupe keys already announced (or deliberately dropped) on this computer. */
  shown: ReadonlySet<string>;
  /** When the local daily summary last went out, or null. */
  localSummarySentAt: number | null;
};

export type FeedPlan = {
  /** Items to announce with an OS notification. */
  show: NotificationItem[];
  /** Items to remember as handled without announcing (already raised locally, or dropped). */
  handled: NotificationItem[];
};

function sameLocalDay(a: number, b: number): boolean {
  const first = new Date(a);
  const second = new Date(b);
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function osEnabled(settings: NotificationSettings, event: NotificationEventKey): boolean {
  return settings.preferences.some(
    (p) => p.scope === "user" && p.event === event && p.channel === "os" && p.enabled,
  );
}

/**
 * Which server items become OS notifications. Rules, in order: only unread items (the phone may
 * have read it already), nothing older than a day, nothing announced before (dedupe key), nothing
 * this desktop raised itself (agent events, a daily summary already sent today), nothing whose OS
 * channel is off, and nothing during quiet hours (dropped, like the server drops phone push).
 * Mandatory events (a sign-in from a new device) skip the last two rules.
 */
export function planFeed(items: readonly NotificationItem[], context: FeedContext): FeedPlan {
  const plan: FeedPlan = { show: [], handled: [] };
  const seen = new Set<string>();
  for (const item of items) {
    if (item.readAt !== null) continue;
    const createdAt = Date.parse(item.createdAt);
    if (!Number.isFinite(createdAt) || context.now - createdAt > FEED_MAX_AGE_MS) continue;
    if (context.shown.has(item.dedupeKey) || seen.has(item.dedupeKey)) continue;
    seen.add(item.dedupeKey);
    if (RAISED_LOCALLY.has(item.event)) {
      plan.handled.push(item);
      continue;
    }
    if (
      item.event === "summary.daily" &&
      context.localSummarySentAt !== null &&
      sameLocalDay(context.localSummarySentAt, createdAt)
    ) {
      plan.handled.push(item);
      continue;
    }
    if (!notificationEvent(item.event).mandatory) {
      if (!osEnabled(context.settings, item.event)) continue;
      if (
        inQuietHours(context.settings.quietHours, createdAt) ||
        inQuietHours(context.settings.quietHours, context.now)
      ) {
        plan.handled.push(item);
        continue;
      }
    }
    plan.show.push(item);
  }
  return plan;
}
