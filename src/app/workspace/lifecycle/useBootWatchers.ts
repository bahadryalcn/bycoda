import { useEffect, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { startGroupLockWatcher } from "../../../features/group-lock/model/groupLock";
import { startAppSync } from "../../../features/sync/model/useSync";
import { subscribeSyncedProjectsAdded } from "../../../features/sync/model/syncRemoteProjects";
import { preloadEditorFind } from "../../../features/files/editor/editorFindBridge";
import {
  loadNotificationsEnabled,
  probeNotificationPermission,
} from "../../../features/notifications/model/notifications";
import { loadRecents } from "../../../features/projects/model/recents";

export interface BootWatcherDeps {
  setRecents: Dispatch<SetStateAction<ReturnType<typeof loadRecents>>>;
}

/** App-wide boot listeners: group lock watcher, app sync, synced-project additions, editor preload. */
export function useBootWatchers({ setRecents }: BootWatcherDeps): void {
  useEffect(() => startGroupLockWatcher(), []);
  useEffect(() => startAppSync(), []);
  // The editor is kept out of the boot chunk; fetch it once the app is up so
  // find-in-file works before the first file is opened.
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const idle = window.requestIdleCallback(() => void preloadEditorFind());
      return () => window.cancelIdleCallback(idle);
    }
    // Older WebViews without requestIdleCallback fall back to a boot timer.
    const timer = window.setTimeout(() => void preloadEditorFind(), 1_500);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => subscribeSyncedProjectsAdded(() => setRecents(loadRecents())), []);
}

/** Probes the OS notification permission once; see the call site for the reason. */
export function useNotificationPermissionProbe(): void {
  // Cache the OS decision so a turn ending later can skip a denied banner.
  useEffect(() => {
    if (loadNotificationsEnabled()) void probeNotificationPermission();
  }, []);
}

/** Sets the window's traffic lights visible once on mount. */
export function useTrafficLightsVisible(): void {
  useEffect(() => {
    void invoke("set_traffic_lights_visible", { visible: true }).catch(() => {});
  }, []);
}
