import { useEffect, useRef, type MutableRefObject } from "react";
import { getWindowState, subscribeWindowState } from "../../../platform/tauri/windowState";

/**
 * Tracks whether the native window is fullscreen. The ref is read synchronously by
 * keyboard handling, so it follows the shared window state, which is read on
 * subscribe and on every native resize.
 */
export function useNativeFullscreen(): MutableRefObject<boolean> {
  const nativeFullscreenRef = useRef(false);
  useEffect(() => {
    const sync = () => {
      const state = getWindowState();
      if (state) nativeFullscreenRef.current = state.fullscreen;
    };
    sync();
    return subscribeWindowState(sync);
  }, []);
  return nativeFullscreenRef;
}
