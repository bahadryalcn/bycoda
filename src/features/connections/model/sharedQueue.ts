import type { QueuedMessage } from "../../sessions/model/session";
import type { RemoteQueue } from "./remoteQueue";

export const SHARED_QUEUE_CAPABILITY = "sessions.queue";
/** Native queue keys accept only letters, numbers, underscores and hyphens. */
export const sharedQueueStorageId = (environmentId: string, sessionId: string): string =>
  `shared_${Array.from(new TextEncoder().encode(JSON.stringify([environmentId, sessionId])), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
export type SharedQueue = RemoteQueue & {
  revision: number;
  consumer?: string;
  claim?: { id: string; clientId: string; token: string };
  settled?: { token: string; clientId: string; accepted: boolean };
};
export type QueueChange = {
  before: RemoteQueue;
  after: RemoteQueue;
  consumer?: string;
};
export const sameQueueValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

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
  if (!sameQueueValue(oldOrder, newOrder)) {
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
  if (change.consumer) result.consumer = change.consumer;
  if (!messages.length) {
    result.status = undefined;
    result.editingId = undefined;
  }
  return result;
}
