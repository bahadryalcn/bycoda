import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { retainAsyncSubscription } from "../../../shared/lib/asyncSubscription";
import { syncDockBadge } from "../../../features/notifications/model/dockBadge";
import { setWindowFocused } from "../../../features/notifications/model/notifications";
import { sessionsRef } from "../../../features/sessions/model/sessionsStore";

export interface WindowFocusLifecycleDeps {
  flushHarnessEvents: () => void;
  projectTerminalFocusedRef: MutableRefObject<boolean>;
  searchViewOpenRef: MutableRefObject<boolean>;
  inboxViewOpenRef: MutableRefObject<boolean>;
  notesViewOpenRef: MutableRefObject<boolean>;
  automationsViewOpenRef: MutableRefObject<boolean>;
  settingsOpenRef: MutableRefObject<boolean>;
  setComposerFocused: Dispatch<SetStateAction<boolean>>;
  setComposerFocusToken: Dispatch<SetStateAction<number>>;
}

/** Window focus (flush harness events, refocus the composer) and visibility flush. */
export function useWindowFocusLifecycle({
  flushHarnessEvents,
  projectTerminalFocusedRef,
  searchViewOpenRef,
  inboxViewOpenRef,
  notesViewOpenRef,
  automationsViewOpenRef,
  settingsOpenRef,
  setComposerFocused,
  setComposerFocusToken,
}: WindowFocusLifecycleDeps): void {
  useEffect(() => {
    return retainAsyncSubscription(
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        setWindowFocused(focused);
        if (focused) {
          flushHarnessEvents();
          syncDockBadge(sessionsRef.current);
          if (
            document.activeElement === document.body &&
            !projectTerminalFocusedRef.current &&
            !searchViewOpenRef.current &&
            !inboxViewOpenRef.current &&
            !notesViewOpenRef.current &&
            !automationsViewOpenRef.current &&
            !settingsOpenRef.current
          ) {
            setComposerFocused(true);
            setComposerFocusToken((token) => token + 1);
          }
        }
      }),
      (error) => console.warn("Window focus subscription failed", error),
    );
  }, [flushHarnessEvents]);

  useEffect(() => {
    const onVisible = () => {
      // Flush on hiding too: WebKit can suspend a pending animation frame,
      // leaving the last output stranded until another event or activation.
      flushHarnessEvents();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [flushHarnessEvents]);
}
