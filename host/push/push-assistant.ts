import type { AssistantNotification } from "../../src/shared/model/host-contracts/assistant";
import type { StoreDatabase } from "../store-db";
import type { BackgroundEffectSource } from "../assistant/native/assistant-background-effect";
import type { ExpoPushMessage } from "./expo-push";
import type { PushRecipient } from "./push-store";

/** Kinds worth waking the owner during quiet hours; `job.waiting` is only urgent with approvals pending. */
const URGENT_KINDS: ReadonlySet<AssistantNotification["kind"]> = new Set([
  "job.failed",
  "job.stalled",
  "task.needsInput",
  "budget.exhausted",
  "owner.question",
]);
export const assistantPushUrgent = (notification: AssistantNotification): boolean =>
  notification.urgent ?? URGENT_KINDS.has(notification.kind);
const BODY_MAX = 200;

export type AssistantPushSource = () => Promise<AssistantNotification[]>;

/** Phone privacy and quiet choices apply independently of desktop activity. */
export function assistantPushAllowed(
  notification: AssistantNotification,
  recipient: PushRecipient,
): boolean {
  if (!recipient.events.assistant) return false;
  if (notification.eligible) return true;
  return (
    notification.deferredReason === "quiet" &&
    recipient.assistantUrgentDuringQuiet &&
    assistantPushUrgent(notification)
  );
}

export function assistantPushMessage(
  recipient: PushRecipient,
  notification: AssistantNotification,
  environmentId: string,
): ExpoPushMessage {
  const body = [...notification.body.trim()].slice(0, BODY_MAX).join("");
  return {
    to: recipient.pushToken,
    title: [...notification.title.trim()].slice(0, BODY_MAX).join("") || recipient.title,
    body: body || recipient.texts.assistant,
    data: {
      kind: "assistant",
      notificationId: notification.id,
      assistantKind: notification.kind,
      environmentId,
      ...(notification.jobId ? { jobId: notification.jobId } : {}),
    },
    sound: "default",
    channelId: "bycoda",
    priority: "high",
  };
}

/** Remembers which phone already heard about which notification, across Host restarts. */
export class AssistantPushLedger {
  private ready: Promise<void> | undefined;

  constructor(private readonly db: StoreDatabase) {}

  prepare(): Promise<void> {
    this.ready ??= this.db
      .exec(
        `CREATE TABLE IF NOT EXISTS push_assistant_sent (
        device_hash TEXT NOT NULL,
        notification_id TEXT NOT NULL,
        sent_at INTEGER NOT NULL,
        PRIMARY KEY (device_hash, notification_id)
      )`,
      )
      .then(() =>
        this.db.exec(`CREATE TABLE IF NOT EXISTS push_assistant_occurrences (
      device_hash TEXT NOT NULL,
      notification_id TEXT NOT NULL,
      occurrence INTEGER NOT NULL,
      reserved_at INTEGER NOT NULL,
      state TEXT NOT NULL,
      PRIMARY KEY (device_hash, notification_id, occurrence)
    )`),
      )
      .then(() =>
        this.db.exec(`CREATE TABLE IF NOT EXISTS push_assistant_operations (
      device_hash TEXT NOT NULL, notification_id TEXT NOT NULL, occurrence INTEGER NOT NULL,
      source TEXT NOT NULL, PRIMARY KEY (device_hash, notification_id, occurrence)
    )`),
      );
    return this.ready;
  }

  async sent(deviceHash: string, ids: readonly string[]): Promise<Set<string>> {
    await this.prepare();
    const found = new Set<string>();
    for (const id of ids) {
      const row = await this.db
        .prepare(
          "SELECT 1 AS hit FROM push_assistant_sent WHERE device_hash=? AND notification_id=?",
        )
        .get(deviceHash, id);
      if (row) found.add(id);
    }
    return found;
  }

  async record(deviceHash: string, id: string, at: number): Promise<void> {
    await this.prepare();
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO push_assistant_sent (device_hash, notification_id, sent_at) VALUES (?, ?, ?)",
      )
      .run(deviceHash, id, at);
  }

  /** Persist before dispatch. A lost receipt fences all later reminders until owner acknowledgement. */
  async reserve(
    deviceHash: string,
    notification: AssistantNotification,
    now: number,
  ): Promise<number | null> {
    await this.prepare();
    const previous = await this.db
      .prepare(
        "SELECT occurrence,reserved_at,state FROM push_assistant_occurrences WHERE device_hash=? AND notification_id=? ORDER BY occurrence DESC LIMIT 1",
      )
      .get(deviceHash, notification.id);
    let occurrence = 0;
    if (previous) {
      const repeats = assistantPushUrgent(notification)
        ? Math.min(10, Math.max(0, notification.repeatCount ?? 2))
        : 0;
      const interval =
        Math.min(1440, Math.max(1, notification.repeatIntervalMinutes ?? 30)) * 60000;
      if (
        previous.state !== "accepted" ||
        Number(previous.occurrence) >= repeats ||
        now - Number(previous.reserved_at) < interval
      )
        return null;
      occurrence = Number(previous.occurrence) + 1;
    } else if ((await this.sent(deviceHash, [notification.id])).has(notification.id)) {
      // Legacy once-only receipts have no occurrence identity. Never replay them after migration.
      return null;
    }
    const result = await this.db
      .prepare(
        "INSERT OR IGNORE INTO push_assistant_occurrences (device_hash,notification_id,occurrence,reserved_at,state) VALUES (?,?,?,?, 'unknown')",
      )
      .run(deviceHash, notification.id, occurrence, now);
    return Number(result.changes) === 1 ? occurrence : null;
  }

  async accept(deviceHash: string, id: string, occurrence: number): Promise<void> {
    await this.prepare();
    await this.db
      .prepare(
        "UPDATE push_assistant_occurrences SET state='accepted' WHERE device_hash=? AND notification_id=? AND occurrence=?",
      )
      .run(deviceHash, id, occurrence);
  }

  async unconfirmed(deviceHash: string, id: string): Promise<number | null> {
    await this.prepare();
    const row = await this.db
      .prepare(
        "SELECT occurrence,state FROM push_assistant_occurrences WHERE device_hash=? AND notification_id=? ORDER BY occurrence DESC LIMIT 1",
      )
      .get(deviceHash, id);
    return row?.state === "unknown" ? Number(row.occurrence) : null;
  }

  async saveOperation(
    deviceHash: string,
    id: string,
    occurrence: number,
    source: BackgroundEffectSource,
  ): Promise<void> {
    await this.prepare();
    await this.db
      .prepare("INSERT OR IGNORE INTO push_assistant_operations VALUES (?,?,?,?)")
      .run(deviceHash, id, occurrence, JSON.stringify(source));
  }

  async operation(
    deviceHash: string,
    id: string,
    occurrence: number,
  ): Promise<BackgroundEffectSource | null> {
    await this.prepare();
    const row = await this.db
      .prepare(
        "SELECT source FROM push_assistant_operations WHERE device_hash=? AND notification_id=? AND occurrence=?",
      )
      .get(deviceHash, id, occurrence);
    return row ? (JSON.parse(String(row.source)) as BackgroundEffectSource) : null;
  }

  /** Only a durable Native receipt proving no callback ran permits releasing this reservation. */
  async releaseUnsent(deviceHash: string, id: string, occurrence: number): Promise<void> {
    await this.prepare();
    await this.db
      .prepare(
        "DELETE FROM push_assistant_occurrences WHERE device_hash=? AND notification_id=? AND occurrence=? AND state='unknown'",
      )
      .run(deviceHash, id, occurrence);
  }
}
