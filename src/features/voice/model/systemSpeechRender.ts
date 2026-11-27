import { invoke, isTauri } from "@tauri-apps/api/core";
import { IS_WIN } from "../../../platform/tauri/platform";
import { loadVoiceSettings } from "./voiceSettings";

/**
 * `speechSynthesis` always plays on the system default output. When the owner picked another
 * audio output, the desktop app renders the same installed voice to WAV so it can play through
 * the routed output context. Windows only for now.
 */
export function shouldRenderSystemSpeech(): boolean {
  return isTauri() && IS_WIN && Boolean(loadVoiceSettings().speakerOutputId);
}

/** WAV bytes of `text` in an installed voice for `language` (two-letter code). */
export function renderSystemSpeech(text: string, language: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("voice_system_speech", {
    text,
    language: /^[a-z]{2}$/.test(language) ? language : "",
  });
}
