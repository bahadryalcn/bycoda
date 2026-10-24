import type { QueuedMessage } from "../../sessions/model/session";
import type { RemoteQueue } from "./remoteQueue";
import { canonicalJson } from "../../sync/model/canonicalJson";
import { RUN_LEASE_TTL_MS } from "../../sync/model/runLease";

export const SHARED_QUEUE_CAPABILITY = "sessions.queue";
/** The host grants a drain lease (holder, epoch, expiry) instead of a permanent consumer. */
export const QUEUE_LEASE_CAPABILITY = "sessions.queue.lease";
/**
 * A drain lease lasts this long without a renewal (the desktop heartbeat renews it).
 * The same as the run lease, for the same reason: a hidden, throttled window beats
 * only about once a minute, and a shorter lease would lapse under a window that is
 * still alive, so its queue would change hands back and forth ("flap"). The price is
 * that a crashed window holds its queue for up to this long, which others see as a wait.
 */
export const QUEUE_LEASE_TTL_MS = RUN_LEASE_TTL_MS;
/** Native queue keys accept only letters, numbers, underscores and hyphens. */
export const sharedQueueStorageId = (environmentId: string, sessionId: string): string =>
  `shared_${Array.from(new TextEncoder().encode(JSON.stringify([environmentId, sessionId])), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
/**
 * Who drains the queue. `holder` is a stable per-window desktop id
 * (`desktop:<instance>`), or a legacy client that has not learned leases yet.
 * `epoch` grows on every takeover and fences a returning old holder; the lease
 * is live until `expiresAt` (host clock). With no live lease the home host drains.
 */
export type DrainLease = { holder: string; epoch: number; expiresAt: number; legacy?: true };
export type SharedQueue = RemoteQueue & {
  revision: number;
  drain?: DrainLease;
  /** `at` and `legacy` are the host's own bookkeeping; a client only passes them along. */
  claim?: {
    id: string;
    clientId: string;
    token: string;
    epoch?: number;
    at?: number;
    legacy?: true;
  };
  settled?: {
    token: string;
    clientId: string;
    accepted: boolean;
    reaped?: true;
    id?: string;
    prior?: "active";
  };
  /** Why the host holds a paused queue ("stopped" after a Stop, else a provider error). */
  holdReason?: string;
  /** Wire only: the host understands leases (an older host sends `consumer`). */
  leased?: true;
  /** Wire only: the host clock when this was read, to judge `drain.expiresAt`. */
  hostTime?: number;
  /** Wire only, older hosts: the single permanent owner. */
  consumer?: string;
};
export type QueueChange = {
  before: RemoteQueue;
  after: RemoteQueue;
};
/** Whether a lease is live at `now` (local clock) given the host/local clock offset. */
export const leaseLive = (drain: DrainLease | undefined, now: number, skew = 0): boolean =>
  !!drain && drain.expiresAt > now + skew;
/** The shared queue could not be coordinated right now: the host was unreachable
 * or another computer changed or owns the queue. Nothing was sent, so this is
 * not a delivery failure and never pauses a queue; the dispatcher tries again. */
export class QueueNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueNotReadyError";
  }
}
export const sameQueueValue = (a: unknown, b: unknown): boolean =>
  a === undefined || b === undefined ? a === b : canonicalJson(a) === canonicalJson(b);

/** Merge changes to distinct rows; reject competing edits to the same row. */
export function mergeQueueChange(current: SharedQueue, change: QueueChange): SharedQueue {
  const { before, after } = change;
  const old = new Map(before.messages.map((row) => [row.id, row]));
  const next = new Map(after.messages.map((row) => [row.id, row]));
  const rows = new Map(current.messages.map((row) => [row.id, row]));
  for (const [id, row] of old) {
    if (sameQueueValue(row, next.get(id))) continue;
    if (current.claim?.id === id) throw new Error("This queued message is being sent.");
    if (sameQueueValue(rows.get(id), next.get(id))) continue; // retry after a lost reply
    if (!sameQueueValue(rows.get(id), row))
      throw new Error("This queued message changed on another computer. Reopen it before editing.");
    if (next.has(id)) rows.set(id, next.get(id)!);
    else rows.delete(id);
  }
  for (const [id, row] of next) {
    if (old.has(id)) continue;
    if (rows.has(id) && !sameQueueValue(rows.get(id), row))
      throw new Error("Queued message ID already exists.");
    rows.set(id, row);
  }
  let messages: QueuedMessage[] = current.messages
    .filter((row) => rows.has(row.id))
    .map((row) => rows.get(row.id)!);
  for (const row of after.messages)
    if (rows.has(row.id) && !messages.some((entry) => entry.id === row.id))
      messages.push(rows.get(row.id)!);
  const oldOrder = before.messages.filter((row) => next.has(row.id)).map((row) => row.id);
  const newOrder = after.messages.filter((row) => old.has(row.id)).map((row) => row.id);
  const appendedOrder = [
    ...oldOrder,
    ...after.messages.filter((row) => !old.has(row.id)).map((row) => row.id),
  ];
  const requestedOrder = after.messages.map((row) => row.id);
  if (!sameQueueValue(appendedOrder, requestedOrder)) {
    if (current.claim) throw new Error("Wait for the queued send before changing its order.");
    const currentOrder = current.messages
      .filter((row) => old.has(row.id) && next.has(row.id))
      .map((row) => row.id);
    if (!sameQueueValue(currentOrder, oldOrder) && !sameQueueValue(currentOrder, newOrder))
      throw new Error("The queue order changed on another computer. Try again.");
    const order = after.messages.map((row) => row.id);
    messages = [
      ...order.flatMap((id) => (rows.has(id) ? [rows.get(id)!] : [])),
      ...messages.filter((row) => !next.has(row.id)),
    ];
  }
  const result = { ...current, messages };
  for (const field of ["status", "editingId"] as const) {
    if (before[field] === after[field]) continue;
    if (current[field] !== before[field] && current[field] !== after[field])
      throw new Error("The queue state changed on another computer. Try again.");
    Object.assign(result, { [field]: after[field] });
  }
  if (!messages.length) {
    result.status = undefined;
    result.editingId = undefined;
  }
  return result;
}
