import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

/** Approval cards currently on screen in a transcript, keyed `sessionId:requestId`. */
const onScreen = new Set<string>();
const listeners = new Set<() => void>();
const key = (sessionId: string, requestId: number) => `${sessionId}:${requestId}`;

function set(id: string, visible: boolean) {
  if (visible === onScreen.has(id)) return;
  if (visible) onScreen.add(id);
  else onScreen.delete(id);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Reports whether the transcript's approval card is on screen, so the composer's activity
 * dock offers the same decision only while the card is scrolled away or not rendered.
 */
export function useReportApprovalCardOnScreen<T extends Element>(
  sessionId: string,
  requestId: number,
): RefObject<T | null> {
  const ref = useRef<T>(null);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- IntersectionObserver on the card, held while it is mounted
  useEffect(() => {
    const element = ref.current;
    const id = key(sessionId, requestId);
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) =>
        set(
          id,
          entries.some((entry) => entry.isIntersecting),
        ),
      { root: element.closest(".agent-transcript") },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      set(id, false);
    };
  }, [sessionId, requestId]);
  return ref;
}

export function useApprovalCardOnScreen(sessionId: string, requestId: number): boolean {
  const id = key(sessionId, requestId);
  const read = () => onScreen.has(id);
  return useSyncExternalStore(subscribe, read, read);
}
