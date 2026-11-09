import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("focus", listener);
  window.addEventListener("blur", listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    window.removeEventListener("focus", listener);
    window.removeEventListener("blur", listener);
    document.removeEventListener("visibilitychange", listener);
  };
}

const snapshot = () => document.visibilityState === "visible" && document.hasFocus();

/** True while the document is shown and the window has focus. */
export function useWindowActive(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
