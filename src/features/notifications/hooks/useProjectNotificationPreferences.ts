import { useSyncExternalStore } from "react";
import {
  loadNotificationPreferences,
  notificationPreferencesSnapshot,
  notificationPreferencesStatus,
  retryNotificationPreferencesRead,
  subscribeNotificationPreferences,
} from "../model/notificationPreferences";

/** Share persisted preferences and mute expiry updates across menus and Settings. */
export function useProjectNotificationPreferences() {
  useSyncExternalStore(
    subscribeNotificationPreferences,
    notificationPreferencesSnapshot,
    notificationPreferencesSnapshot,
  );
  return loadNotificationPreferences();
}

/** Whether the stored project preferences could be read, with a read-only retry. */
export function useProjectNotificationPreferencesStatus() {
  useSyncExternalStore(
    subscribeNotificationPreferences,
    notificationPreferencesSnapshot,
    notificationPreferencesSnapshot,
  );
  return { status: notificationPreferencesStatus(), retry: retryNotificationPreferencesRead };
}
