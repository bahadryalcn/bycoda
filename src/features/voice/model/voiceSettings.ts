import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import type { VoiceRuntimeConfig } from "./localVoiceClient";

export type VoiceSettings = {
  enabled: boolean;
  natural: boolean;
  python: string;
  whisperPath: string;
  ttsPath: string;
};
const defaults: VoiceSettings = {
  enabled: false,
  natural: true,
  python: "",
  whisperPath: "",
  ttsPath: "",
};
const preference = createStoredSetting<VoiceSettings>({
  key: "bycoda.voice",
  fallback: defaults,
  event: "bycoda:voice-settings",
  storageEvents: true,
  parse: (raw) => {
    const value = JSON.parse(raw);
    return {
      enabled: value?.enabled === true,
      natural: value?.natural !== false,
      python: typeof value?.python === "string" ? value.python : "",
      whisperPath: typeof value?.whisperPath === "string" ? value.whisperPath : "",
      ttsPath: typeof value?.ttsPath === "string" ? value.ttsPath : "",
    };
  },
  serialize: JSON.stringify,
});
export const loadVoiceSettings = preference.load;
export const saveVoiceSettings = preference.save;
export const subscribeVoiceSettings = preference.subscribe;
export function useVoiceSettings() {
  return useStoredPreferenceState(loadVoiceSettings, subscribeVoiceSettings)[0];
}
export function voiceRuntimeSettings(value: VoiceSettings): VoiceRuntimeConfig {
  return {
    natural: value.natural,
    ...(value.python.trim() ? { python: value.python.trim() } : {}),
    ...(value.whisperPath.trim() ? { whisperPath: value.whisperPath.trim() } : {}),
    ...(value.ttsPath.trim() ? { ttsPath: value.ttsPath.trim() } : {}),
  };
}
