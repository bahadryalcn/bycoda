import { useSyncExternalStore } from "react";
import type { DeliverySettlement } from "../../../shared/lib/deliveryUnknown";

export type DeliveryReviewOutcome = "delivered" | "retry" | "keep" | "discard";

/**
 * Resume on a queue whose last delivery is unconfirmed cannot decide for the
 * owner. It asks the inline delivered / send again / discard choice to take
 * focus, so Resume always answers with something visible.
 */
const requests = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function requestDeliveryReview(sessionId: string): void {
  requests.set(sessionId, (requests.get(sessionId) ?? 0) + 1);
  notify();
}

/** Increments each time Resume asks for this conversation's delivery review. */
export function useDeliveryReviewRequest(sessionId: string): number {
  return useSyncExternalStore(subscribe, () => requests.get(sessionId) ?? 0);
}

/** Why the host holds each paused queue (`holdReason`), for the banner; cleared once it runs again. */
const holdReasons = new Map<string, string>();
export function setQueueHoldReason(sessionId: string, reason: string | undefined): void {
  if (holdReasons.get(sessionId) === reason) return;
  if (reason) holdReasons.set(sessionId, reason);
  else holdReasons.delete(sessionId);
  notify();
}
export const queueHoldReason = (sessionId: string): string | undefined =>
  holdReasons.get(sessionId);
export function useQueueHoldReason(sessionId: string): string | undefined {
  return useSyncExternalStore(subscribe, () => holdReasons.get(sessionId));
}

/**
 * Sends that were given up as unconfirmed but whose provider call is still open:
 * it may yet deliver the message. While one is, sending the same message again
 * could duplicate it, so the review warns and does not offer "Send again".
 */
const lateSettlements = new Map<string, number[]>();
/**
 * A provider call that never answers must not hold Resume and the queue for
 * good: after this long the owner is trusted again (Send again, Resume).
 */
export const LATE_SETTLEMENT_MAX_MS = 10 * 60_000;
const openSettlements = (sessionId: string): number =>
  (lateSettlements.get(sessionId) ?? []).filter((at) => Date.now() - at < LATE_SETTLEMENT_MAX_MS)
    .length;

/** Follows an unconfirmed send until its provider call finally answers. */
export function trackLateSettlement(
  sessionId: string,
  settlement: Promise<DeliverySettlement>,
): void {
  const at = Date.now();
  lateSettlements.set(sessionId, [...(lateSettlements.get(sessionId) ?? []), at]);
  notify();
  const done = () => {
    const left = [...(lateSettlements.get(sessionId) ?? [])];
    const index = left.indexOf(at);
    if (index >= 0) left.splice(index, 1);
    if (left.length) lateSettlements.set(sessionId, left);
    else lateSettlements.delete(sessionId);
    notify();
  };
  void settlement.then(done, done);
}

/** Whether an unconfirmed send of this conversation may still be answered by its provider. */
export function lateSettlementPossible(sessionId: string): boolean {
  return openSettlements(sessionId) > 0;
}

/** Forgets every tracked send (tests). */
export function resetLateSettlementsForTests(): void {
  lateSettlements.clear();
}

export function useLateSettlementPossible(sessionId: string): boolean {
  return useSyncExternalStore(subscribe, () => lateSettlementPossible(sessionId));
}

/**
 * Who settles an unconfirmed row of a conversation. The window's own sessions
 * resolve it in the desktop store; a pane showing another computer's queue
 * registers its resolver here, so the same inline choice decides through the
 * shared queue instead of editing a store that does not own the row.
 */
export type DeliveryResolver = (rowId: string, outcome: DeliveryReviewOutcome) => Promise<void>;
const resolvers = new Map<string, DeliveryResolver>();
export function registerDeliveryResolver(
  sessionId: string,
  resolver: DeliveryResolver,
): () => void {
  resolvers.set(sessionId, resolver);
  return () => {
    if (resolvers.get(sessionId) === resolver) resolvers.delete(sessionId);
  };
}
export const deliveryResolverFor = (sessionId: string): DeliveryResolver | undefined =>
  resolvers.get(sessionId);
