import type { AssistantNotification } from "../../src/shared/model/host-contracts/assistant";
import type { StoreDatabase } from "../store-db";
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
const BODY_MAX = 200;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export type AssistantPushSource = () => Promise<AssistantNotification[]>;

/** Whether this notification may reach this phone now; presence of the desktop is checked by the caller. */
export function assistantPushAllowed(
  notification: AssistantNotification,
  recipient: PushRecipient,
): boolean {
  if (!recipient.events.assistant) return false;
  if (notification.eligible) return true;
  return (
    notification.deferredReason === "quiet" &&
    recipient.assistantUrgentDuringQuiet &&
    URGENT_KINDS.has(notification.kind)
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
    this.ready ??= this.db.exec(
      `CREATE TABLE IF NOT EXISTS push_assistant_sent (
        device_hash TEXT NOT NULL,
        notification_id TEXT NOT NULL,
        sent_at INTEGER NOT NULL,
        PRIMARY KEY (device_hash, notification_id)
      )`,
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

  async prune(now: number): Promise<void> {
    await this.prepare();
    await this.db.prepare("DELETE FROM push_assistant_sent WHERE sent_at<?").run(now - KEEP_MS);
  }
}
