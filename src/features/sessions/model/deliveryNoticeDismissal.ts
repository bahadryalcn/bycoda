import { useSyncExternalStore } from "react";
import { createStore } from "../../../shared/lib/store";

/**
 * Dismissed delivery notices, kept outside the pane so a remount does not bring a closed notice
 * back. The key names one notice (session plus operation or unknown row); a new operation has a
 * new key and shows again. The stored number is the delivery-review request count at dismissal:
 * a later review request re-opens the notice.
 */
const dismissed = new Map<string, number>();
const store = createStore();

export const deliveryNoticeKey = (sessionId: string, id: string | number) => `${sessionId}:${id}`;

export function dismissDeliveryNotice(key: string, reviewRequest = 0): void {
  dismissed.set(key, reviewRequest);
  store.notify();
}

export function reopenDeliveryNotice(key: string): void {
  if (dismissed.delete(key)) store.notify();
}

export const deliveryNoticeDismissed = (key: string, reviewRequest = 0) => {
  const at = dismissed.get(key);
  return at !== undefined && reviewRequest <= at;
};

export function useDeliveryNoticeDismissed(key: string | undefined, reviewRequest = 0): boolean {
  return useSyncExternalStore(store.subscribe, () =>
    key ? deliveryNoticeDismissed(key, reviewRequest) : false,
  );
}

export function resetDeliveryNoticeDismissals(): void {
  dismissed.clear();
  store.notify();
}
