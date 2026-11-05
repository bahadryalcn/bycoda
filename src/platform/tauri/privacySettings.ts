import { invoke } from "@tauri-apps/api/core";

export type PrivacyPane = "screen-recording" | "microphone" | "files-and-folders";

/** Opens an allowlisted OS privacy pane; microphone supports macOS and Windows. */
export function openPrivacySettings(pane: PrivacyPane): Promise<void> {
  return invoke<void>("open_privacy_settings", { pane });
}
