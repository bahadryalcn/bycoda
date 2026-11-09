import type {
  NotificationFeed,
  NotificationFeedQuery,
  NotificationSettings,
} from "@bycoda/account-contracts";

/** The only three events the desktop reports. No titles, session names, prompts or paths. */
export type ServerReportEvent = "agent.finished" | "agent.failed" | "approval.pending";

export type ServerEventReport = {
  event: ServerReportEvent;
  /** Stable per occurrence; the server pushes one phone notification per key. */
  dedupeKey: string;
  occurredAt: string;
};

/**
 * What the notification client needs from the account service. The account feature (or the app
 * shell) binds an implementation with `bindNotificationsServer`; nothing here knows about tokens.
 */
export interface NotificationsServerPort {
  getSettings(): Promise<NotificationSettings>;
  putSettings(settings: NotificationSettings): Promise<NotificationSettings>;
  listFeed(query: NotificationFeedQuery): Promise<NotificationFeed>;
  markRead(ids: string[]): Promise<void>;
  reportEvent(report: ServerEventReport): Promise<void>;
}

let bound: NotificationsServerPort | null = null;

export function bindNotificationsServer(port: NotificationsServerPort | null): void {
  bound = port;
}

export function notificationsServerPort(): NotificationsServerPort | null {
  return bound;
}
