import { listenWindow, type WindowSubscription } from "./listenWindow";

/**
 * Emitted by `src-tauri/src/desktop_talk_shortcut.rs` to the main window only, after the
 * owner presses the OS-wide "Talk to assistant" shortcut and the window was shown and focused.
 * Payload: `{ source: "global-shortcut", at: <epoch ms> }`. Pressing is an explicit owner
 * action; whether capture may start (voice connected, permissions) stays the subscriber's call.
 */
export const VOICE_TALK_EVENT = "bycoda-voice-talk";

export type VoiceTalkPayload = { source: "global-shortcut"; at: number };

/** Subscribe on this window; returns a synchronous disposer. */
export function listenVoiceTalk(handler: (payload: VoiceTalkPayload) => void): WindowSubscription {
  return listenWindow<VoiceTalkPayload>(VOICE_TALK_EVENT, (message) => handler(message.payload));
}

/** Reveal the workspace that recognized the owner's local wake phrase. */
export async function revealVoiceTalkWindow(): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const workspace = getCurrentWindow();
  await workspace.unminimize();
  await workspace.show();
  await workspace.setFocus();
}
