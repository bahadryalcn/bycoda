import { settingSnapshot } from "./settingSnapshot";
import { useState, useSyncExternalStore } from "react";
import {
  loadCollapsedProjectRailMode,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  subscribeLiveAgentsEnabled,
  subscribeNotesEnabled,
  type CollapsedProjectRailMode,
} from "../../../features/settings/model/settings";

const notes = settingSnapshot(loadNotesEnabled, subscribeNotesEnabled);
const agents = settingSnapshot(loadLiveAgentsEnabled, subscribeLiveAgentsEnabled);

/** Flags mirrored from the persisted settings store, plus the collapsed rail mode. */
export function useSettingsBackedFlags() {
  const notesEnabled = useSyncExternalStore(notes.subscribe, notes.getSnapshot, () => true);
  const liveAgentsEnabled = useSyncExternalStore(agents.subscribe, agents.getSnapshot, () => true);
  const [collapsedProjectRailMode, setCollapsedProjectRailMode] =
    useState<CollapsedProjectRailMode>(loadCollapsedProjectRailMode);
  return {
    notesEnabled,
    liveAgentsEnabled,
    collapsedProjectRailMode,
    setCollapsedProjectRailMode,
  };
}
