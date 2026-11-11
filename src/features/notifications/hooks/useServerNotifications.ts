import { useEffect } from "react";
import { useAccountContext } from "../../account";
import { isLeadWindow } from "../../../platform/tauri/workspaceWindows";
import { loadDailySummarySentAt } from "../model/dailySummarySettings";
import { isWindowFocused, notifyServerItem } from "../model/notifications";
import { notificationsServerPort } from "../model/serverPort";
import { readLocalSnapshot, writeLocalSnapshot } from "../model/serverPreferences";
import { activateServerSync } from "../model/serverRuntime";
import { createServerSync } from "../model/serverSync";
import {
  loadPendingRead,
  loadShownKeys,
  loadSyncBase,
  rememberShown,
  savePendingRead,
  saveSyncBase,
} from "../model/serverShownStore";

/** The feed is fetched on focus and this often while the app is open. */
export const SERVER_POLL_MS = 3 * 60_000;

type RefreshState = { cancelled: boolean; refreshing: boolean };

async function refreshServerSync(state: RefreshState, sync: ReturnType<typeof createServerSync>) {
  if (state.refreshing) return;
  state.refreshing = true;
  try {
    await sync.syncSettings();
    // One window announces; every window keeps its settings in step and can report events.
    if (!state.cancelled && (await isLeadWindow())) await sync.poll();
    if (!state.cancelled) await sync.flushRead();
  } catch {
    // Offline or signed out remotely: the next poll tries again.
  } finally {
    state.refreshing = false;
  }
}

/**
 * Connects the desktop to the signed-in account's notifications: keeps the preferences in step,
 * announces server items (new device, announcements) as OS notifications, syncs read state and
 * lets agent events reach the phone. Signed out, or without a bound account service, it does
 * nothing and makes no request.
 */
export function useServerNotifications(): void {
  const userId = useAccountContext()?.user.id ?? null;
  useEffect(() => {
    const port = notificationsServerPort();
    if (!userId || !port) return;
    const sync = createServerSync({
      port,
      userId,
      now: Date.now,
      isFocused: isWindowFocused,
      localSummarySentAt: loadDailySummarySentAt,
      announce: (item) => notifyServerItem({ title: item.title, body: item.body }),
      local: { read: readLocalSnapshot, write: writeLocalSnapshot },
      store: {
        loadBase: loadSyncBase,
        saveBase: saveSyncBase,
        loadShown: loadShownKeys,
        rememberShown,
        loadPendingRead,
        savePendingRead,
      },
    });
    activateServerSync(sync);
    const state: RefreshState = { cancelled: false, refreshing: false };
    const refresh = () => refreshServerSync(state, sync);
    const onFocus = () => refresh().catch(() => undefined);
    refresh().catch(() => undefined);
    const timer = setInterval(() => refresh().catch(() => undefined), SERVER_POLL_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      state.cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      activateServerSync(null);
    };
  }, [userId]);
}
