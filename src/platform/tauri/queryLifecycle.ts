import { focusManager, onlineManager } from "@tanstack/react-query";
import { isTauri } from "@tauri-apps/api/core";
import { setNativePollingWindow } from "../../shared/lib/foregroundPolling";
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
    let focusedWhileDomHidden = false;
    let disposed = false;
    const fromNative = () => {
      const state = getWindowState();
      if (disposed || !state || windowStateReads().applied <= ignoreThrough) return;
      const shown =
        state.visible &&
        !state.minimized &&
        (document.visibilityState !== "hidden" || (focusedWhileDomHidden && state.focused));
      setNativePollingWindow({ shown, focused: state.focused });
      setFocused(shown && state.focused);
    };
    const visible = (event?: Event) => {
      if (document.visibilityState === "hidden") {
        if (event?.type === "focus" && focusedWhileDomHidden) return;
        ignoreThrough = windowStateReads().started;
        focusedWhileDomHidden = false;
        if (refreshNative) setNativePollingWindow({ shown: false, focused: false });
        setFocused(false);
      } else if (refreshNative) void refreshNative().catch(report);
      else setFocused(true);
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    const releases: Array<() => void> = [];
    if (isTauri()) {
      refreshNative = async () => {
        const hiddenAt = ignoreThrough;
        try {
          await refreshWindowState();
        } catch (error) {
          report(error);
          // No native read succeeded; DOM focus is the only signal left, unless a hide
          // or native focus payload arrived meanwhile and already decided.
          if (!disposed && ignoreThrough === hiddenAt && document.visibilityState !== "hidden") {
            const focused = document.hasFocus();
            setNativePollingWindow({ shown: true, focused });
            setFocused(focused);
          }
          return;
        }
        fromNative();
      };
      // The shared window state owns the native listeners; resize covers hide/minimize.
      releases.push(subscribeWindowState(fromNative));
      releases.push(
        subscribeWindowFocus((focused) => {
          if (disposed) return;
          ignoreThrough = windowStateReads().started;
          focusedWhileDomHidden = focused && document.visibilityState === "hidden";
          if (focused) setNativePollingWindow({ shown: true, focused: true });
          else {
            const state = getWindowState();
            setNativePollingWindow({
              shown: document.visibilityState !== "hidden" && !!state?.visible && !state.minimized,
              focused: false,
            });
          }
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
      if (refreshNative) setNativePollingWindow();
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
