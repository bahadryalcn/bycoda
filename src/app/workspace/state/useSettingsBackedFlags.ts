import { useState, useSyncExternalStore } from "react";
import {
  loadCollapsedProjectRailMode,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  subscribeLiveAgentsEnabled,
  subscribeNotesEnabled,
  type CollapsedProjectRailMode,
} from "../../../features/settings/model/settings";

/** Flags mirrored from the persisted settings store, plus the collapsed rail mode. */
export function useSettingsBackedFlags() {
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  const liveAgentsEnabled = useSyncExternalStore(
    subscribeLiveAgentsEnabled,
    loadLiveAgentsEnabled,
    () => true,
  );
  const [collapsedProjectRailMode, setCollapsedProjectRailMode] =
    useState<CollapsedProjectRailMode>(loadCollapsedProjectRailMode);
  return {
    notesEnabled,
    liveAgentsEnabled,
    collapsedProjectRailMode,
    setCollapsedProjectRailMode,
  };
}
