import { invoke } from "@tauri-apps/api/core";
import { Update } from "@tauri-apps/plugin-updater";
import { createStoredSetting } from "../../../shared/lib/storedSetting";

/** Stable reads the release feed only; preview also reads the preview feed (newer wins). */
export type UpdateChannel = "stable" | "preview";

const channelSetting = createStoredSetting<UpdateChannel | null>({
  key: "bycoda.updateChannel",
  fallback: null,
  event: "bycoda:update-channel-change",
  storageEvents: true,
  parse: (raw) => (raw === "preview" || raw === "stable" ? raw : null),
  serialize: String,
});

export const subscribeUpdateChannel = channelSetting.subscribe;

export function saveUpdateChannel(channel: UpdateChannel) {
  channelSetting.save(channel);
}

/** The saved choice; an install that never chose follows the channel it was installed from. */
export function loadUpdateChannel(currentVersion: string | undefined): UpdateChannel {
  return channelSetting.load() ?? (/-preview\./.test(currentVersion ?? "") ? "preview" : "stable");
}

/**
 * Checks the feeds of the chosen channel. The native command owns both feed URLs and
 * returns the plugin's own update handle, so download, signature check and install stay
 * with the updater plugin.
 */
export async function checkForAppUpdate(currentVersion: string): Promise<Update | null> {
  const metadata = await invoke<ConstructorParameters<typeof Update>[0] | null>(
    "app_update_check",
    { preview: loadUpdateChannel(currentVersion) === "preview" },
  );
  return metadata ? new Update(metadata) : null;
}
