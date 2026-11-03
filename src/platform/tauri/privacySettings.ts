import { invoke } from "@tauri-apps/api/core";

export type PrivacyPane = "screen-recording" | "microphone" | "files-and-folders";

/** Opens the macOS Privacy & Security pane for a capability the app was denied. */
export function openPrivacySettings(pane: PrivacyPane): Promise<void> {
  return invoke<void>("open_privacy_settings", { pane });
}
