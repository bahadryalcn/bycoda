import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { RemoteQueue } from "../src/features/connections/model/remoteQueue";
import {
  mergeQueueChange,
  sameQueueValue,
  type SharedQueue,
} from "../src/features/connections/model/sharedQueue";
import { restoreQueuedMessages } from "../src/features/sessions/model/queuePersistence";

/** Separate durable state: provider snapshots and desktop refreshes cannot erase it. */
export class SessionQueues {
  constructor(private readonly db: DatabaseSync) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS session_queues (session_id TEXT PRIMARY KEY, payload TEXT NOT NULL)",
    );
    db.exec(
      "CREATE TABLE IF NOT EXISTS session_queue_removed (session_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(session_id, message_id))",
    );
  }
  get(id: string): SharedQueue {
    const row = this.db.prepare("SELECT payload FROM session_queues WHERE session_id=?").get(id);
    return row ? (JSON.parse(String(row.payload)) as SharedQueue) : { messages: [], revision: 0 };
  }
  private save(id: string, queue: SharedQueue): SharedQueue {
    const next = { ...queue, revision: queue.revision + 1 };
    this.db
      .prepare(
        "INSERT INTO session_queues VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET payload=excluded.payload",
      )
      .run(id, JSON.stringify(next));
    return next;
  }
  change(id: string, before: unknown, after: unknown, consumer?: string): SharedQueue {
    const current = this.get(id);
    const old = this.parse(before);
    const incoming = this.parse(after);
    incoming.messages = incoming.messages.filter(
      (row) =>
        old.messages.some((entry) => entry.id === row.id) ||
        !this.db
          .prepare("SELECT 1 FROM session_queue_removed WHERE session_id=? AND message_id=?")
          .get(id, row.id),
    );
    const next = mergeQueueChange(current, { before: old, after: incoming, consumer });
    if (next.messages.length > 100 || Buffer.byteLength(JSON.stringify(next)) > 3 * 1024 * 1024)
      throw new Error("Shared queue is full.");
    for (const row of current.messages)
      if (!next.messages.some((entry) => entry.id === row.id)) this.removed(id, row.id);
    return sameQueueValue(current, next) ? current : this.save(id, next);
  }
  private parse(raw: unknown): RemoteQueue {
    if (!raw || typeof raw !== "object") throw new Error("Invalid queue");
    const value = raw as RemoteQueue;
    if (!Array.isArray(value.messages) || value.messages.length > 100)
      throw new Error("Invalid queue messages");
    const messages = restoreQueuedMessages(value.messages);
    if (
      messages.length !== value.messages.length ||
      new Set(messages.map((row) => row.id)).size !== messages.length
    )
      throw new Error("Invalid queued message");
    if (
      value.status !== undefined &&
      !["active", "paused", "restored", "resuming"].includes(value.status)
    )
      throw new Error("Invalid queue status");
    if (
      value.editingId !== undefined &&
      (typeof value.editingId !== "string" || !messages.some((row) => row.id === value.editingId))
    )
      throw new Error("Invalid queued edit");
    return { messages, status: value.status, editingId: value.editingId };
  }
  assertSend(
    id: string,
    rowId: string,
    clientId: string,
    revision: number,
    steer = false,
  ): SharedQueue {
    const queue = this.get(id);
    if (
      queue.revision !== revision ||
      queue.consumer !== clientId ||
      queue.claim ||
      queue.editingId ||
      (!steer && queue.status !== "active") ||
      !queue.messages.some((row) => row.id === rowId && !row.deliveryUnknown) ||
      (!steer && queue.messages[0]?.id !== rowId)
    )
      throw new Error("The shared queue changed. Refresh it before sending.");
    return queue;
  }
  claim(id: string, rowId: string, clientId: string, revision: number, steer = false): SharedQueue {
    const queue = this.assertSend(id, rowId, clientId, revision, steer);
    return this.save(id, { ...queue, claim: { id: rowId, clientId, token: randomUUID() } });
  }
  finish(id: string, token: string, accepted: boolean): SharedQueue {
    const queue = this.get(id);
    if (queue.settled?.token === token && queue.settled.accepted === accepted) return queue;
    if (queue.claim?.token !== token)
      throw new Error("Queued send no longer belongs to this client.");
    const messages = accepted
      ? queue.messages.filter((row) => row.id !== queue.claim!.id)
      : queue.messages;
    if (accepted) this.removed(id, queue.claim.id);
    return this.save(id, {
      ...queue,
      messages,
      status: messages.length
        ? accepted && queue.status === "restored"
          ? "active"
          : queue.status
        : undefined,
      settled: { token, clientId: queue.claim.clientId, accepted },
      claim: undefined,
    });
  }
  consumed(id: string, rowId: string): SharedQueue {
    const queue = this.get(id);
    const messages = queue.messages.filter((row) => row.id !== rowId);
    this.removed(id, rowId);
    return this.save(id, {
      ...queue,
      messages,
      status: messages.length ? queue.status : undefined,
    });
  }
  delete(id: string): void {
    this.db.prepare("DELETE FROM session_queues WHERE session_id=?").run(id);
    this.db.prepare("DELETE FROM session_queue_removed WHERE session_id=?").run(id);
  }
  private removed(id: string, rowId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO session_queue_removed VALUES (?, ?)").run(id, rowId);
  }
}
