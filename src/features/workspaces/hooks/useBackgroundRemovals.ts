import { useSyncExternalStore } from "react";
import { backgroundRemovals, subscribeBackgroundRemovals } from "../model/backgroundRemoval";

/** Folder keys whose removal is running; rows use it to show progress and block other actions. */
export function useBackgroundRemovals(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeBackgroundRemovals, backgroundRemovals, backgroundRemovals);
}
