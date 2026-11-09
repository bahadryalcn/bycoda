import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (open === next) return;
  open = next;
  for (const listener of Array.from(listeners)) listener();
}

/** Opens the one feedback dialog, mounted once at app level. */
export const openFeedbackDialog = () => set(true);
export const closeFeedbackDialog = () => set(false);

export function useFeedbackDialogOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
  );
}
