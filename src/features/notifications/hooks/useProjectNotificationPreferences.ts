import { useSyncExternalStore } from "react";
import {
  notificationPreferencesViewSnapshot,
  retryNotificationPreferencesRead,
  subscribeNotificationPreferences,
} from "../model/notificationPreferences";

/** Preferences, read status and muted ids from one store subscription. */
export function useNotificationPreferencesView() {
  return useSyncExternalStore(
    subscribeNotificationPreferences,
    notificationPreferencesViewSnapshot,
    notificationPreferencesViewSnapshot,
  );
}

/** Share persisted preferences and mute expiry updates across menus and Settings. */
export function useProjectNotificationPreferences() {
  return useNotificationPreferencesView().preferences;
}

/** Whether the stored project preferences could be read, with a read-only retry. */
export function useProjectNotificationPreferencesStatus() {
  const { unavailable } = useNotificationPreferencesView();
  const handleRetryRead = () => retryNotificationPreferencesRead();
  return {
    status: unavailable ? ("unavailable" as const) : ("ready" as const),
    retry: handleRetryRead,
  };
}
