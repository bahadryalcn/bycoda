import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import { settingSnapshot } from "./settingSnapshot";
import { useSyncExternalStore } from "react";
import {
  loadCollapsedProjectRailMode,
  subscribeCollapsedProjectRailMode,
  loadLiveAgentsEnabled,
  loadNotesEnabled,
  subscribeLiveAgentsEnabled,
  subscribeNotesEnabled,
} from "../../../features/settings/model/settings";

const notes = settingSnapshot(loadNotesEnabled, subscribeNotesEnabled);
const agents = settingSnapshot(loadLiveAgentsEnabled, subscribeLiveAgentsEnabled);

/** Flags mirrored from the persisted settings store, plus the collapsed rail mode. */
export function useSettingsBackedFlags() {
  const notesEnabled = useSyncExternalStore(notes.subscribe, notes.getSnapshot, () => true);
  const liveAgentsEnabled = useSyncExternalStore(agents.subscribe, agents.getSnapshot, () => true);
  const [collapsedProjectRailMode, setCollapsedProjectRailMode] =
    useStoredPreferenceState(loadCollapsedProjectRailMode, subscribeCollapsedProjectRailMode);
  return {
    notesEnabled,
    liveAgentsEnabled,
    collapsedProjectRailMode,
    setCollapsedProjectRailMode,
  };
}
