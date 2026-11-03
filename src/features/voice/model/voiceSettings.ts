import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import type { VoiceDevice, VoiceEngine, VoiceRuntimeConfig } from "./localVoiceClient";
import { DEFAULT_SPEAKERS, SPEAKER_IDS, type SpeakerEngine } from "./voiceSpeakers";

export type VoiceVisual = "mark" | "wave" | "dots" | "orb";
/** Who runs the conversation: local recognition + the session's provider, or a
 * cloud speech-to-speech model signed in through Grok Build or Codex. */
export type VoiceMode = "local" | "grok" | "openai";

export type VoiceSettings = {
  manualTurnEnd?: boolean;
  manualTurnEndRevision?: number;
  microphoneId?: string;
  turnEndSilence?: number;
  holdAnnouncements?: boolean;
  allowBargeIn?: boolean;
  visual: VoiceVisual;
  compact: boolean;
  enabled: boolean;
  /** Zero disables idle sleep; otherwise minutes without owner input. */
  idleSleepMinutes: number;
  natural: boolean;
  mode: VoiceMode;
  /** Natural voice model: Supertonic (fast, default), VoxCPM2 (richer, needs a
   * GPU) or ElevenLabs (cloud; only the reply text leaves this computer). */
  engine: VoiceEngine;
  /** ElevenLabs voice ID; empty uses the built-in multilingual default. */
  elevenVoice: string;
  /** Speaker voice per engine (Supertonic, Grok Voice, OpenAI Realtime). */
  speakers: Record<SpeakerEngine, string>;
  device: VoiceDevice;
  python: string;
  whisperPath: string;
  ttsPath: string;
};
const defaults: VoiceSettings = {
  visual: "mark",
  compact: false,
  enabled: false,
  idleSleepMinutes: 10,
  natural: true,
  mode: "local",
  engine: "supertonic",
  elevenVoice: "",
  speakers: DEFAULT_SPEAKERS,
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
      ...(typeof value?.manualTurnEnd === "boolean" ? { manualTurnEnd: value.manualTurnEnd } : {}),
      ...(Number.isSafeInteger(value?.manualTurnEndRevision) && value.manualTurnEndRevision >= 0
        ? { manualTurnEndRevision: value.manualTurnEndRevision }
        : {}),
      ...(typeof value?.microphoneId === "string" && value.microphoneId.length <= 300
        ? { microphoneId: value.microphoneId }
        : {}),
      ...(Number.isFinite(value?.turnEndSilence) &&
      value.turnEndSilence >= 0.5 &&
      value.turnEndSilence <= 5
        ? { turnEndSilence: value.turnEndSilence }
        : {}),
      ...(typeof value?.holdAnnouncements === "boolean"
        ? { holdAnnouncements: value.holdAnnouncements }
        : {}),
      ...(typeof value?.allowBargeIn === "boolean" ? { allowBargeIn: value.allowBargeIn } : {}),
      idleSleepMinutes:
        Number.isInteger(value?.idleSleepMinutes) &&
        value.idleSleepMinutes >= 0 &&
        value.idleSleepMinutes <= 120
          ? value.idleSleepMinutes
          : 10,
      natural: value?.natural !== false,
      mode: value?.mode === "grok" || value?.mode === "openai" ? value.mode : "local",
      engine:
        value?.engine === "voxcpm2" || value?.engine === "elevenlabs" ? value.engine : "supertonic",
      elevenVoice:
        typeof value?.elevenVoice === "string" && /^[A-Za-z0-9]{0,64}$/.test(value.elevenVoice)
          ? value.elevenVoice
          : "",
      speakers: Object.fromEntries(
        (Object.keys(DEFAULT_SPEAKERS) as SpeakerEngine[]).map((engine) => {
          const chosen = value?.speakers?.[engine];
          return [engine, SPEAKER_IDS[engine].includes(chosen) ? chosen : DEFAULT_SPEAKERS[engine]];
        }),
      ) as Record<SpeakerEngine, string>,
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
    ...(value.natural && value.engine !== "supertonic" ? { engine: value.engine } : {}),
    ...(value.natural && value.engine === "elevenlabs" && value.elevenVoice
      ? { voiceId: value.elevenVoice }
      : {}),
    // The default speaker is omitted so existing runtime keys stay stable.
    ...(value.natural &&
    value.engine === "supertonic" &&
    value.speakers.supertonic !== DEFAULT_SPEAKERS.supertonic
      ? { voiceId: value.speakers.supertonic }
      : {}),
    // Automatic is the Host default; omitting it keeps existing runtime keys stable.
    ...(value.device !== "auto" ? { device: value.device } : {}),
    ...(value.python.trim() ? { python: value.python.trim() } : {}),
    ...(value.whisperPath.trim() ? { whisperPath: value.whisperPath.trim() } : {}),
    ...(value.ttsPath.trim() ? { ttsPath: value.ttsPath.trim() } : {}),
  };
}
