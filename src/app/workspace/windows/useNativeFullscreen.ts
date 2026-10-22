import { useEffect, useRef, type MutableRefObject } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Tracks whether the native window is fullscreen. The ref is read synchronously by
 * keyboard handling, so it is refreshed on mount and on every native resize.
 */
export function useNativeFullscreen(): MutableRefObject<boolean> {
  const nativeFullscreenRef = useRef(false);
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const window = getCurrentWindow();
    const refresh = async () => {
      const current = ++revision;
      try {
        const full = await window.isFullscreen();
        if (!disposed && current === revision) nativeFullscreenRef.current = full;
      } catch {}
    };
    void refresh();
    const resized = window.onResized(() => void refresh());
    return () => {
      disposed = true;
      void resized.then((unlisten) => unlisten()).catch(() => {});
    };
  }, []);
  return nativeFullscreenRef;
}
