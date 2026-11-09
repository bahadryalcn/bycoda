import type { NotificationEventKey, NotificationSettings } from "@bycoda/account-contracts";
import {
  DAILY_SUMMARY_ENABLED_DEFAULT,
  DAILY_SUMMARY_TIME_DEFAULT,
  loadDailySummaryEnabled,
  loadDailySummaryTime,
  saveDailySummaryEnabled,
  saveDailySummaryTime,
} from "./dailySummarySettings";
import {
  loadNotificationEvents,
  saveNotificationEvent,
  type NotificationEventSetting,
} from "./notificationEvents";

export type SyncValue = string | boolean;
export type SyncSnapshot = Record<string, SyncValue>;
type SyncField = {
  key: string;
  localDefault: SyncValue;
  serverDefault: SyncValue;
  /** Server event whose `os` channel carries this boolean. */
  event?: NotificationEventKey;
  read(): SyncValue;
  write(value: SyncValue): void;
};

/** Server default of `dailySummaryTime` in the contract (`defaultNotificationSettings`). */
const SERVER_SUMMARY_TIME_DEFAULT = "18:00";

const osEvent = (local: NotificationEventSetting, event: NotificationEventKey): SyncField => ({
  key: `os:${event}`,
  event,
  localDefault: true,
  serverDefault: true,
  read: () => loadNotificationEvents()[local],
  write: (value) => {
    saveNotificationEvent(local, value === true);
  },
});

/**
 * The local settings that mirror a server setting. The existing daily summary time is extended,
 * not replaced: it stays in its own storage key and this list only reads and writes it.
 */
const FIELDS: readonly SyncField[] = [
  {
    key: "dailySummaryTime",
    localDefault: DAILY_SUMMARY_TIME_DEFAULT,
    serverDefault: SERVER_SUMMARY_TIME_DEFAULT,
    read: loadDailySummaryTime,
    write: (value) => {
      saveDailySummaryTime(String(value));
    },
  },
  {
    key: "os:summary.daily",
    event: "summary.daily",
    localDefault: DAILY_SUMMARY_ENABLED_DEFAULT,
    serverDefault: false,
    read: loadDailySummaryEnabled,
    write: (value) => {
      saveDailySummaryEnabled(value === true);
    },
  },
  osEvent("finished", "agent.finished"),
  osEvent("failed", "agent.failed"),
  osEvent("input", "approval.pending"),
];

export function readLocalSnapshot(): SyncSnapshot {
  return Object.fromEntries(FIELDS.map((field) => [field.key, field.read()]));
}

export function writeLocalSnapshot(changes: SyncSnapshot): void {
  for (const field of FIELDS) {
    const value = changes[field.key];
    if (value !== undefined) field.write(value);
  }
}

/** Values the server holds; absent where it has no setting (for example a summary OS channel). */
export function readServerSnapshot(settings: NotificationSettings): Partial<SyncSnapshot> {
  const snapshot: Partial<SyncSnapshot> = {};
  if (settings.dailySummaryTime) snapshot.dailySummaryTime = settings.dailySummaryTime;
  for (const field of FIELDS) {
    if (!field.event) continue;
    const found = settings.preferences.find(
      (p) => p.scope === "user" && p.event === field.event && p.channel === "os",
    );
    if (found) snapshot[field.key] = found.enabled;
  }
  return snapshot;
}

/** A copy of `settings` carrying `changes`; everything else is untouched. */
export function applyToServerSettings(
  settings: NotificationSettings,
  changes: SyncSnapshot,
): NotificationSettings {
  let next = settings;
  for (const field of FIELDS) {
    const value = changes[field.key];
    if (value === undefined) continue;
    if (field.key === "dailySummaryTime") {
      next = { ...next, dailySummaryTime: String(value) };
    } else if (field.event) {
      const event = field.event;
      next = {
        ...next,
        preferences: [
          ...next.preferences.filter(
            (p) => !(p.scope === "user" && p.event === event && p.channel === "os"),
          ),
          { scope: "user", event, channel: "os", enabled: value === true },
        ],
      };
    }
  }
  return next;
}

export type FieldMerge = { value: SyncValue; from: "same" | "local" | "server" };

/**
 * Three-way merge of one setting. `base` is the value both sides agreed on at the last sync.
 * One side changed: that side wins. Both changed: the account (server) wins, because it is the
 * value the user's other devices already follow. First sync (no base): the server wins unless it
 * still holds its factory default while this computer was customised.
 */
export function mergeField(
  base: SyncValue | undefined,
  local: SyncValue,
  server: SyncValue | undefined,
  defaults: { local: SyncValue; server: SyncValue },
): FieldMerge {
  if (server === undefined) return { value: local, from: "local" };
  if (local === server) return { value: local, from: "same" };
  if (base === undefined) {
    return server === defaults.server && local !== defaults.local
      ? { value: local, from: "local" }
      : { value: server, from: "server" };
  }
  if (local !== base && server === base) return { value: local, from: "local" };
  return { value: server, from: "server" };
}

export type SettingsMerge = {
  /** Values both sides hold after the merge; stored as the next base. */
  merged: SyncSnapshot;
  /** Changes to write to this computer. */
  toLocal: SyncSnapshot;
  /** Changes to send to the account. */
  toServer: SyncSnapshot;
};

export function mergeSettings(input: {
  base: SyncSnapshot | null;
  local: SyncSnapshot;
  server: Partial<SyncSnapshot>;
}): SettingsMerge {
  const merged: SyncSnapshot = {};
  const toLocal: SyncSnapshot = {};
  const toServer: SyncSnapshot = {};
  for (const field of FIELDS) {
    const local = input.local[field.key];
    if (local === undefined) continue;
    const result = mergeField(input.base?.[field.key], local, input.server[field.key], {
      local: field.localDefault,
      server: field.serverDefault,
    });
    merged[field.key] = result.value;
    if (result.from === "server") toLocal[field.key] = result.value;
    if (result.from === "local" && input.server[field.key] !== result.value) {
      toServer[field.key] = result.value;
    }
  }
  return { merged, toLocal, toServer };
}
