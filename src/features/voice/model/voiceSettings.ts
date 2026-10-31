import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import type { VoiceDevice, VoiceEngine, VoiceRuntimeConfig } from "./localVoiceClient";

export type VoiceVisual = "mark" | "wave" | "dots" | "orb";

export type VoiceSettings = {
  visual: VoiceVisual;
  compact: boolean;
  enabled: boolean;
  natural: boolean;
  /** Natural voice model: Supertonic (fast, default) or VoxCPM2 (richer, needs a GPU). */
  engine: VoiceEngine;
  device: VoiceDevice;
  python: string;
  whisperPath: string;
  ttsPath: string;
};
const defaults: VoiceSettings = {
  visual: "mark",
  compact: false,
  enabled: false,
  natural: true,
  engine: "supertonic",
  device: "auto",
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
      visual: ["mark", "wave", "dots", "orb"].includes(value?.visual)
        ? (value.visual as VoiceVisual)
        : "mark",
      compact: value?.compact === true,
      enabled: value?.enabled === true,
      natural: value?.natural !== false,
      engine: value?.engine === "voxcpm2" ? "voxcpm2" : "supertonic",
      device: value?.device === "gpu" || value?.device === "cpu" ? value.device : "auto",
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
    // Supertonic is the Host default and is omitted.
    ...(value.natural && value.engine === "voxcpm2" ? { engine: value.engine } : {}),
    // Automatic is the Host default; omitting it keeps existing runtime keys stable.
    ...(value.device !== "auto" ? { device: value.device } : {}),
    ...(value.python.trim() ? { python: value.python.trim() } : {}),
    ...(value.whisperPath.trim() ? { whisperPath: value.whisperPath.trim() } : {}),
    ...(value.ttsPath.trim() ? { ttsPath: value.ttsPath.trim() } : {}),
  };
}
