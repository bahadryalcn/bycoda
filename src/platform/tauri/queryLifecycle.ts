import { focusManager, onlineManager } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import {
  getWindowState,
  refreshWindowState,
  subscribeWindowFocus,
  subscribeWindowState,
  windowStateReads,
} from "./windowState";

/** WebViews do not consistently emit DOM visibility events on native hide/minimize. */
export function installQueryLifecycle() {
  focusManager.setEventListener((setFocused) => {
    const report = (error: unknown) => console.warn("Query window lifecycle unavailable", error);
    let refreshNative: (() => Promise<void>) | undefined;
    // Native reads started up to here are older than what focus or DOM visibility said since.
    let ignoreThrough = -1;
    let disposed = false;
    const fromNative = () => {
      const state = getWindowState();
      if (disposed || !state || windowStateReads().applied <= ignoreThrough) return;
      setFocused(state.visible && !state.minimized && state.focused);
    };
    const visible = () => {
      if (document.visibilityState === "hidden") {
        ignoreThrough = windowStateReads().started;
        setFocused(false);
      } else if (refreshNative) void refreshNative().catch(report);
      else setFocused(true);
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    const releases: Array<() => void> = [];
    if (isTauri()) {
      refreshNative = async () => {
        await refreshWindowState();
        fromNative();
      };
      // The shared window state owns the native listeners; resize covers hide/minimize.
      releases.push(subscribeWindowState(fromNative));
      releases.push(
        subscribeWindowFocus((focused) => {
          if (disposed) return;
          ignoreThrough = windowStateReads().started;
          // Native focus is authoritative even if WebKit's DOM visibility is stale.
          setFocused(focused);
        }),
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
