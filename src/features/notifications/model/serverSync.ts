import { isoTimestamp } from "../../../shared/lib/time/timestamps";
import { isChannelOnForPush, type ServerSyncDeps } from "./serverSyncSupport";
import { applyToServerSettings, mergeSettings, readServerSnapshot } from "./serverPreferences";
import { planFeed } from "./serverFeed";
import type { NotificationSettings } from "@bycoda/account-contracts";
import type { ServerReportEvent } from "./serverPort";

export type ServerSync = ReturnType<typeof createServerSync>;

/**
 * One signed-in session of the notification client: keeps local preferences and the account's
 * `NotificationSettings` in step, announces server feed items the desktop has not announced yet,
 * syncs read state and reports agent events for the phone. Every call is best effort; a failure
 * is retried at the next poll and never reaches the user.
 */
export function createServerSync(deps: ServerSyncDeps) {
  const { port, userId, store, local } = deps;
  let settings: NotificationSettings | null = null;
  let announcing = false;

  async function syncSettings(): Promise<NotificationSettings> {
    const server = await port.getSettings();
    const merge = mergeSettings({
      base: store.loadBase(userId),
      local: local.read(),
      server: readServerSnapshot(server),
    });
    if (Object.keys(merge.toLocal).length > 0) local.write(merge.toLocal);
    settings = server;
    if (Object.keys(merge.toServer).length > 0) {
      settings = await port.putSettings(applyToServerSettings(server, merge.toServer));
    }
    store.saveBase(userId, merge.merged);
    return settings;
  }

  /** Fetches the feed and announces what is new. Returns how many OS notifications went out. */
  async function poll(): Promise<number> {
    if (announcing) return 0;
    announcing = true;
    try {
      const current = settings ?? (await syncSettings());
      const feed = await port.listFeed({ limit: 30 });
      const plan = planFeed(feed.items, {
        settings: current,
        now: deps.now(),
        shown: store.loadShown(),
        localSummarySentAt: deps.localSummarySentAt(),
      });
      const announced: string[] = [];
      const readLater: string[] = [];
      for (const item of plan.show) {
        if (await deps.announce(item)) {
          announced.push(item.dedupeKey);
          readLater.push(item.id);
        }
      }
      store.rememberShown([...announced, ...plan.handled.map((item) => item.dedupeKey)]);
      if (readLater.length > 0) {
        store.savePendingRead([...store.loadPendingRead(), ...readLater]);
      }
      return announced.length;
    } finally {
      announcing = false;
    }
  }

  /**
   * Announced items count as read once the user is back in the app, so the phone's badge clears.
   * Items that were only handled (raised locally, dropped) stay unread for the other devices.
   */
  async function flushRead(): Promise<void> {
    if (!deps.isFocused()) return;
    const ids = store.loadPendingRead();
    if (ids.length === 0) return;
    await port.markRead(ids.slice(0, 100));
    store.savePendingRead(ids.slice(100));
  }

  /**
   * Tells the account an agent event happened so the phone can be notified. Only when push is on
   * for that event; with unknown settings nothing is reported.
   */
  async function report(event: ServerReportEvent, dedupeKey: string, occurredAt: number) {
    if (!settings || !isChannelOnForPush(settings, event)) return;
    const at = isoTimestamp(occurredAt);
    if (at) await port.reportEvent({ event, dedupeKey, occurredAt: at });
  }

  return { syncSettings, poll, flushRead, report, settings: () => settings };
}
