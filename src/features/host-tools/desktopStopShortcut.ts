import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  loadKeybindingOverrides,
  subscribeKeybindings,
  type KeybindingOverrides,
} from "../settings/model/settings";
import { desktopStopShortcut } from "../settings/model/desktopStopKeybinding";

export async function applyDesktopStopShortcut(overrides: KeybindingOverrides): Promise<void> {
  await invoke("desktop_shortcut_configure", { shortcut: desktopStopShortcut(overrides) });
}

/** Native registration owns dispatch; this installs no competing keyboard listener. */
export function startDesktopStopShortcut(): () => void {
  if (!isTauri()) return () => {};
  const sync = () => {
    void applyDesktopStopShortcut(loadKeybindingOverrides()).catch((error) =>
      console.warn("Could not register emergency computer shortcut", error),
    );
  };
  sync();
  return subscribeKeybindings(sync);
}
