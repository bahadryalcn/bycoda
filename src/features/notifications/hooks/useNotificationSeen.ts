import { useSyncExternalStore } from "react";
import { readNotificationSeenAt, subscribeNotificationSeen } from "../model/notificationSeen";

/** Epoch ms the owner last saw notifications; re-renders when it changes in any window. */
export function useNotificationSeenAt(): number {
  return useSyncExternalStore(
    subscribeNotificationSeen,
    () => readNotificationSeenAt(),
    () => readNotificationSeenAt(),
  );
}
