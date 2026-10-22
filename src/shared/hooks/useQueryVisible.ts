import { useSyncExternalStore } from "react";
import { focusManager } from "@tanstack/react-query";

const subscribe = (listener: () => void) => focusManager.subscribe(listener);
const snapshot = () => focusManager.isFocused();

/** Also gates the initial fetch, which refetchIntervalInBackground does not. */
export function useQueryVisible() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
