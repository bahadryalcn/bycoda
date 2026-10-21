export type DeliveryStage =
  | "syncing"
  | "claiming"
  | "preparing"
  | "provider"
  | "confirming"
  | "accepted"
  | "rejected"
  | "unknown";
export type DeliveryProgress = {
  operationId: number;
  messageId: string;
  stage: DeliveryStage;
  startedAt: number;
  detail?: string;
  /** A manual review must not discard ownership of an outstanding late acknowledgement. */
  reconcileUntil?: number;
};

// Session-owned rather than composer-owned: switching panes must not hide a send.
const values = new Map<string, DeliveryProgress>();
const operations = new Map<string, Map<string, DeliveryProgress>>();
let operationId = 0;
const listeners = new Set<() => void>();
export const subscribeDeliveryProgress = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const readDeliveryProgress = (sessionId: string, messageId?: string) =>
  messageId ? operations.get(sessionId)?.get(messageId) : values.get(sessionId);
const pending = (value: DeliveryProgress) =>
  !["accepted", "rejected", "unknown"].includes(value.stage);
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
  listeners.forEach((listener) => listener());
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
  publish(sessionId);
  return value;
}
export function updateDeliveryProgress(
  sessionId: string,
  owner: DeliveryProgress,
  stage: DeliveryStage,
  detail?: string,
) {
  const current = operations.get(sessionId)?.get(owner.messageId);
  if (current?.operationId !== owner.operationId) return;
  operations.get(sessionId)!.set(owner.messageId, {
    ...current,
    stage,
    detail,
    ...(stage === "unknown" ? { reconcileUntil: Date.now() + 6 * 60_000 } : {}),
  });
  publish(sessionId);
}
export function clearDeliveryProgress(sessionId: string, owner: DeliveryProgress) {
  if (operations.get(sessionId)?.get(owner.messageId)?.operationId !== owner.operationId) return;
  operations.get(sessionId)!.delete(owner.messageId);
  publish(sessionId);
}
