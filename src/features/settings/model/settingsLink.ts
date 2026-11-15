import type { SettingsSectionId } from "./settings";

export const OPEN_SETTINGS_EVENT = "bycoda:open-settings";

/** Open through the workspace surface, preserving its return view and reveal state. */
export function openSettingsSection(section: SettingsSectionId) {
  window.dispatchEvent(
    new CustomEvent<SettingsSectionId>(OPEN_SETTINGS_EVENT, { detail: section }),
  );
}
