import { focusManager, onlineManager } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { retainAsyncSubscription } from "../../shared/lib/asyncSubscription";

/** WebViews do not consistently emit DOM visibility events on native hide/minimize. */
export function installQueryLifecycle() {
  focusManager.setEventListener((setFocused) => {
    const report = (error: unknown) => console.warn("Query window lifecycle unavailable", error);
    let refreshNative: (() => Promise<void>) | undefined;
    let revision = 0;
    const visible = () => {
      if (document.visibilityState === "hidden") {
        ++revision;
        setFocused(false);
      } else if (refreshNative) void refreshNative().catch(report);
      else setFocused(true);
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    const releases: Array<() => void> = [];
    let disposed = false;
    if (isTauri()) {
      const nativeWindow = getCurrentWindow();
      const syncNative = async () => {
        const current = ++revision;
        const [shown, minimized, focused] = await Promise.all([
          nativeWindow.isVisible(),
          nativeWindow.isMinimized(),
          nativeWindow.isFocused(),
        ]);
        if (!disposed && current === revision) setFocused(shown && !minimized && focused);
      };
      refreshNative = syncNative;
      releases.push(
        retainAsyncSubscription(
          nativeWindow.onFocusChanged(({ payload }) => {
            if (disposed) return;
            ++revision;
            // Native focus is authoritative even if WebKit's DOM visibility is stale.
            setFocused(payload);
          }),
          report,
        ),
      );
      releases.push(
        retainAsyncSubscription(
          nativeWindow.onResized(() => {
            void syncNative().catch(report);
          }),
          report,
        ),
      );
    }
    visible();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
      releases.forEach((release) => release());
    };
  });
  onlineManager.setEventListener((setOnline) => {
    const online = () => setOnline(true);
    const offline = () => setOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    // navigator.onLine may be false on a private LAN; events are the source of truth.
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  });
  return () => {
    focusManager.setEventListener(() => undefined);
    onlineManager.setEventListener(() => undefined);
    focusManager.setFocused(undefined);
  };
}
