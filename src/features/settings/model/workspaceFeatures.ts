import { useSyncExternalStore } from "react";
import { storedFlag } from "../../../shared/lib/storedSetting";
import { loadNotesEnabled, saveNotesEnabled, subscribeNotesEnabled } from "./settings";

export const WORKSPACE_FEATURE_IDS = ["tasks", "automations", "inbox", "notes", "social"] as const;
export type WorkspaceFeatureId = (typeof WORKSPACE_FEATURE_IDS)[number];

function navigationSetting(id: string) {
  const setting = storedFlag(
    `bycoda.workspace.${id}.visible.v1`,
    true,
    `bycoda:workspace-${id}-change`,
    true,
  );
  return { ...setting, load: () => setting.load() ?? true };
}

/** Navigation preferences only: hiding a tool never stops work or changes its permissions. */
export const workspaceFeatureSettings = {
  tasks: navigationSetting("tasks"),
  automations: navigationSetting("automations"),
  inbox: navigationSetting("inbox"),
  notes: { load: loadNotesEnabled, save: saveNotesEnabled, subscribe: subscribeNotesEnabled },
  social: navigationSetting("social"),
};

export function useWorkspaceFeature(id: WorkspaceFeatureId): boolean {
  const setting = workspaceFeatureSettings[id];
  return useSyncExternalStore(setting.subscribe, setting.load, () => true);
}

export function useWorkspaceFeatures(): Record<WorkspaceFeatureId, boolean> {
  return {
    tasks: useWorkspaceFeature("tasks"),
    automations: useWorkspaceFeature("automations"),
    inbox: useWorkspaceFeature("inbox"),
    notes: useWorkspaceFeature("notes"),
    social: useWorkspaceFeature("social"),
  };
}
