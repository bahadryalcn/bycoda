import { createStore } from "../../../shared/lib/store";

export type DeliveryStage =
  | "syncing"
  | "claiming"
  | "preparing"
  | "provider"
  | "confirming"
  | "accepted"
  | "rejected"
  | "unknown"
  /** Nothing reached the provider (storage, host connection, queue race): the row stays queued and is retried. */
  | "waiting";
export type DeliveryProgress = {
  operationId: number;
  messageId: string;
  stage: DeliveryStage;
  startedAt: number;
  detail?: string;
  noticeOnly?: boolean;
  /** A manual review must not discard ownership of an outstanding late acknowledgement. */
  reconcileUntil?: number;
};

// Session-owned rather than composer-owned: switching panes must not hide a send.
const values = new Map<string, DeliveryProgress>();
const operations = new Map<string, Map<string, DeliveryProgress>>();
let operationId = 0;
const store = createStore();
export const subscribeDeliveryProgress = store.subscribe;
export const readDeliveryProgress = (sessionId: string, messageId?: string) =>
  messageId ? operations.get(sessionId)?.get(messageId) : values.get(sessionId);
const pending = (value: DeliveryProgress) =>
  !["accepted", "rejected", "unknown", "waiting"].includes(value.stage);
/**
 * The last "waiting" outcome per session. Every automatic retry of the row starts a new,
 * pending operation; the notice keeps showing this record until that retry settles. It is
 * dropped when the message settles otherwise, its progress is cleared, or another message
 * starts sending.
 */
export type WaitingDelivery = { messageId: string; detail?: string };
const waiting = new Map<string, WaitingDelivery>();
export const readWaitingDelivery = (sessionId: string) => waiting.get(sessionId);
function forgetWaiting(sessionId: string, messageId?: string) {
  if (messageId === undefined || waiting.get(sessionId)?.messageId === messageId)
    waiting.delete(sessionId);
}
function publish(sessionId: string) {
  const rows = [...(operations.get(sessionId)?.values() ?? [])];
  // Keep the oldest blocked send visible even when a newer composer submission arrives.
  const selected =
    rows.filter(pending).sort((a, b) => a.operationId - b.operationId)[0] ??
    rows
      .filter((row) => row.stage === "unknown")
      .sort((a, b) => b.operationId - a.operationId)[0] ??
    rows.sort((a, b) => b.operationId - a.operationId)[0];
  if (selected) values.set(sessionId, selected);
  else {
    values.delete(sessionId);
    operations.delete(sessionId);
  }
  store.notify();
}
export function beginDeliveryProgress(sessionId: string, messageId: string, stage: DeliveryStage) {
  const value: DeliveryProgress = {
    operationId: ++operationId,
    messageId,
    stage,
    startedAt: Date.now(),
  };
  const rows = operations.get(sessionId) ?? new Map<string, DeliveryProgress>();
  for (const [id, row] of rows)
    if (!pending(row) && row.stage !== "unknown" && (row.reconcileUntil ?? 0) < Date.now())
      rows.delete(id);
  rows.set(messageId, value);
  operations.set(sessionId, rows);
  if (waiting.get(sessionId)?.messageId !== messageId) forgetWaiting(sessionId);
  publish(sessionId);
  return value;
}
export function updateDeliveryProgress(
  sessionId: string,
  owner: DeliveryProgress,
  stage: DeliveryStage,
  detail?: string,
  noticeOnly = false,
) {
  const current = operations.get(sessionId)?.get(owner.messageId);
  if (current?.operationId !== owner.operationId) return;
  operations.get(sessionId)!.set(owner.messageId, {
    ...current,
    stage,
    detail,
    noticeOnly,
    ...(stage === "unknown" ? { reconcileUntil: Date.now() + 6 * 60_000 } : {}),
  });
  if (stage === "waiting") {
    const last = waiting.get(sessionId);
    if (last?.messageId !== owner.messageId || last.detail !== detail)
      waiting.set(sessionId, { messageId: owner.messageId, detail });
  } else if (!pending({ ...current, stage })) forgetWaiting(sessionId, owner.messageId);
  publish(sessionId);
}
export function clearDeliveryProgress(sessionId: string, owner: DeliveryProgress) {
  if (operations.get(sessionId)?.get(owner.messageId)?.operationId !== owner.operationId) return;
  operations.get(sessionId)!.delete(owner.messageId);
  forgetWaiting(sessionId, owner.messageId);
  publish(sessionId);
}
