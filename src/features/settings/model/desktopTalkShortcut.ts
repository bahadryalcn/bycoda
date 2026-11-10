import { invoke, isTauri } from "@tauri-apps/api/core";
import { desktopStopShortcut, desktopTalkShortcut } from "./desktopStopKeybinding";
import {
  loadKeybindingOverrides,
  subscribeKeybindings,
  type KeybindingOverrides,
} from "./settings";

/** Applies the OS-wide Talk chord, then the stop chord; a chord the shell already holds is a no-op. */
export async function applyDesktopShortcuts(overrides: KeybindingOverrides): Promise<void> {
  await invoke("desktop_talk_shortcut_configure", { shortcut: desktopTalkShortcut(overrides) });
  await invoke("desktop_shortcut_configure", { shortcut: desktopStopShortcut(overrides) });
}

/**
 * Keeps the native Talk registration in step with saved keybindings. Native registration owns
 * dispatch (`bycoda-voice-talk`); this installs no keyboard listener.
 */
export function startDesktopTalkShortcut(): () => void {
  if (!isTauri()) return () => {};
  const sync = () => {
    void invoke("desktop_talk_shortcut_configure", {
      shortcut: desktopTalkShortcut(loadKeybindingOverrides()),
    }).catch((error) => console.warn("Could not register Talk to assistant shortcut", error));
  };
  sync();
  return subscribeKeybindings(sync);
}
