import type {
  NotificationEventKey,
  NotificationItem,
  NotificationSettings,
} from "@bycoda/account-contracts";
import type { NotificationsServerPort } from "./serverPort";
import type { SyncSnapshot } from "./serverPreferences";

/** Everything `createServerSync` touches besides the account service, so tests can fake it. */
export type ServerSyncDeps = {
  port: NotificationsServerPort;
  userId: string;
  now(): number;
  /** Whether the app window is in front (read state is only synced then). */
  isFocused(): boolean;
  /** When the local daily summary last went out. */
  localSummarySentAt(): number | null;
  /** Shows one OS notification; true once the OS accepted it. */
  announce(item: NotificationItem): Promise<boolean>;
  local: { read(): SyncSnapshot; write(changes: SyncSnapshot): void };
  store: {
    loadBase(userId: string): SyncSnapshot | null;
    saveBase(userId: string, base: SyncSnapshot): void;
    loadShown(): Set<string>;
    rememberShown(keys: readonly string[]): void;
    loadPendingRead(): string[];
    savePendingRead(ids: readonly string[]): void;
  };
};

export function isChannelOnForPush(
  settings: NotificationSettings,
  event: NotificationEventKey,
): boolean {
  return settings.preferences.some(
    (p) => p.scope === "user" && p.event === event && p.channel === "push" && p.enabled,
  );
}
