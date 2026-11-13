import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { truncateCodeUnits } from "../../../shared/lib/text/truncate";
import { useStoredPreferenceState } from "../../../shared/hooks/useStoredPreferenceState";
import type {
  CloudDictationProvider,
  VoiceDevice,
  VoiceEngine,
  VoiceRuntimeConfig,
} from "./localVoiceClient";
import { DEFAULT_SPEAKERS, SPEAKER_IDS, type SpeakerEngine } from "./voiceSpeakers";
import { CLOUD_DICTATION_PROVIDERS, DICTATION_MODELS } from "./dictationModels";
import { SPOKEN_LANGUAGES } from "./voiceSpokenLanguage";
import { WAKE_PHRASE_LIMITS } from "./voiceWakePhrase";

export type VoiceVisual = "mark" | "wave" | "dots" | "orb";
/** Who runs the conversation: local recognition + the session's provider, or a
 * cloud speech-to-speech model signed in through Grok Build or Codex. */
export type VoiceMode = "local" | "grok" | "openai";
/** Dictation recognizer: the local Whisper installation or a cloud speech-to-text API. */
export type DictationEngine = "local" | CloudDictationProvider;
export const DICTATION_ENGINES: readonly DictationEngine[] = [
  "local",
  "openai",
  "xai",
  "openrouter",
];

export type DictationDictionaryEntry = { term: string; aliases: string[]; projectId?: string };
export type DictationCleanup = {
  enabled: boolean;
  model: string;
  instructions: string;
  correctionCue: string;
  translateToEnglish: boolean;
};

export type VoiceSettings = {
  /** Explicit opt-in: OpenAI receives continuous live audio for turn detection. */
  experimentalSemanticVad?: boolean;
  manualTurnEnd?: boolean;
  manualTurnEndRevision?: number;
  microphoneId?: string;
  turnEndSilence?: number;
  holdAnnouncements?: boolean;
  allowBargeIn?: boolean;
  /** Opt-in: speak when the owner returns, then listen for a bounded window. Off by default. */
  returnCall?: boolean;
  /** Seconds the microphone stays open after the return greeting; 5 to 120, default 20. */
  returnCallSeconds?: number;
  /** Opt-in: a local listener opens Talk after the wake phrase; the sleep phrase closes it. */
  wakeEnabled?: boolean;
  /** Owner-typed phrases only (2 to 40 characters); missing means the language default. */
  wakePhrase?: string;
  sleepPhrase?: string;
  visual: VoiceVisual;
  compact: boolean;
  enabled: boolean;
  dictationEnabled: boolean;
  dictationShortcutMode: "auto" | "hold" | "toggle";
  dictationIdleUnloadMinutes: number;
  dictationLocalModelPath: string;
  dictationDictionary: DictationDictionaryEntry[];
  dictationRemoveFillers: boolean;
  dictationSilenceFilter: boolean;
  dictationCleanup: DictationCleanup;
  dictationEngine: DictationEngine;
  /** Chosen transcription model per cloud provider; missing uses the provider default. */
  dictationModels: Partial<Record<CloudDictationProvider, string>>;
  /** "auto" lets the recognizer detect the spoken language; a code forces it. */
  dictationLanguage: "auto" | keyof typeof SPOKEN_LANGUAGES;
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
  experimentalSemanticVad: false,
  visual: "mark",
  compact: false,
  enabled: false,
  dictationEnabled: false,
  dictationShortcutMode: "auto",
  dictationIdleUnloadMinutes: 5,
  dictationLocalModelPath: "",
  dictationDictionary: [],
  dictationRemoveFillers: false,
  dictationSilenceFilter: true,
  dictationCleanup: {
    enabled: false,
    model: "",
    instructions: "",
    correctionCue: "",
    translateToEnglish: false,
  },
  dictationEngine: "local",
  dictationModels: {},
  dictationLanguage: "auto",
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
function wakePhraseField(key: "wakePhrase" | "sleepPhrase", raw: unknown) {
  const text = typeof raw === "string" ? raw.trim() : "";
  return text.length >= WAKE_PHRASE_LIMITS.min && text.length <= WAKE_PHRASE_LIMITS.max
    ? { [key]: text }
    : {};
}
function boundedText(value: unknown, max: number): string {
  return typeof value === "string" ? truncateCodeUnits(value, max) : "";
}
function parseDictationDictionary(value: unknown): DictationDictionaryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((entry): DictationDictionaryEntry[] => {
    if (!entry || typeof entry !== "object") return [];
    const term = boundedText(entry.term, 200).trim();
    if (!term) return [];
    const aliases = Array.isArray(entry.aliases)
      ? entry.aliases
          .slice(0, 30)
          .map((alias: unknown) => boundedText(alias, 200).trim())
          .filter(Boolean)
      : [];
    const projectId = boundedText(entry.projectId, 300).trim();
    return [{ term, aliases, ...(projectId ? { projectId } : {}) }];
  });
}
export function normalizeVoiceSettings(value: VoiceSettings): VoiceSettings {
  return {
    visual: ["mark", "wave", "dots", "orb"].includes(value?.visual)
      ? (value.visual as VoiceVisual)
      : "mark",
    compact: value?.compact === true,
    experimentalSemanticVad: value?.experimentalSemanticVad === true,
    enabled: value?.enabled === true,
    // Preserve existing dictation visibility until its own switch is saved.
    dictationEnabled:
      typeof value?.dictationEnabled === "boolean"
        ? value.dictationEnabled
        : value?.enabled === true,
    dictationShortcutMode:
      value?.dictationShortcutMode === "hold" || value?.dictationShortcutMode === "toggle"
        ? value.dictationShortcutMode
        : "auto",
    dictationIdleUnloadMinutes:
      Number.isInteger(value?.dictationIdleUnloadMinutes) &&
      value.dictationIdleUnloadMinutes >= 0 &&
      value.dictationIdleUnloadMinutes <= 120
        ? value.dictationIdleUnloadMinutes
        : 5,
    dictationLocalModelPath:
      typeof value?.dictationLocalModelPath === "string" ? value.dictationLocalModelPath : "",
    dictationDictionary: parseDictationDictionary(value?.dictationDictionary),
    dictationRemoveFillers: value?.dictationRemoveFillers === true,
    dictationSilenceFilter: value?.dictationSilenceFilter !== false,
    dictationCleanup: {
      enabled: value?.dictationCleanup?.enabled === true,
      model: boundedText(value?.dictationCleanup?.model, 200),
      instructions: boundedText(value?.dictationCleanup?.instructions, 4000),
      correctionCue: boundedText(value?.dictationCleanup?.correctionCue, 100),
      translateToEnglish: value?.dictationCleanup?.translateToEnglish === true,
    },
    dictationEngine: DICTATION_ENGINES.includes(value?.dictationEngine)
      ? (value.dictationEngine as DictationEngine)
      : "local",
    dictationModels: Object.fromEntries(
      CLOUD_DICTATION_PROVIDERS.flatMap((provider) => {
        const chosen = value?.dictationModels?.[provider];
        return (provider === "openrouter" &&
          typeof chosen === "string" &&
          /^[A-Za-z0-9._/-]{1,200}$/.test(chosen)) ||
          DICTATION_MODELS[provider].some((model) => model.id === chosen)
          ? [[provider, chosen as string]]
          : [];
      }),
    ),
    dictationLanguage: Object.prototype.hasOwnProperty.call(
      SPOKEN_LANGUAGES,
      value?.dictationLanguage,
    )
      ? (value.dictationLanguage as keyof typeof SPOKEN_LANGUAGES)
      : "auto",
    ...(typeof value?.manualTurnEnd === "boolean" ? { manualTurnEnd: value.manualTurnEnd } : {}),
    ...(typeof value?.manualTurnEndRevision === "number" &&
    Number.isSafeInteger(value.manualTurnEndRevision) &&
    value.manualTurnEndRevision >= 0
      ? { manualTurnEndRevision: value.manualTurnEndRevision }
      : {}),
    ...(typeof value?.microphoneId === "string" && value.microphoneId.length <= 300
      ? { microphoneId: value.microphoneId }
      : {}),
    ...(typeof value?.turnEndSilence === "number" &&
    Number.isFinite(value.turnEndSilence) &&
    value.turnEndSilence >= 0.5 &&
    value.turnEndSilence <= 5
      ? { turnEndSilence: value.turnEndSilence }
      : {}),
    ...(typeof value?.holdAnnouncements === "boolean"
      ? { holdAnnouncements: value.holdAnnouncements }
      : {}),
    ...(typeof value?.allowBargeIn === "boolean" ? { allowBargeIn: value.allowBargeIn } : {}),
    ...(value?.returnCall === true ? { returnCall: true } : {}),
    ...(value?.wakeEnabled === true ? { wakeEnabled: true } : {}),
    ...wakePhraseField("wakePhrase", value?.wakePhrase),
    ...wakePhraseField("sleepPhrase", value?.sleepPhrase),
    ...(typeof value?.returnCallSeconds === "number" &&
    Number.isInteger(value.returnCallSeconds) &&
    value.returnCallSeconds >= 5 &&
    value.returnCallSeconds <= 120
      ? { returnCallSeconds: value.returnCallSeconds }
      : {}),
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
}
const preference = createStoredSetting<VoiceSettings>({
  key: "bycoda.voice",
  fallback: defaults,
  event: "bycoda:voice-settings",
  storageEvents: true,
  parse: (raw) => normalizeVoiceSettings(JSON.parse(raw)),
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

/**
 * Language sent with each dictation phrase. Cloud APIs treat it as the output
 * language and translate other speech into it, so Automatic sends none there;
 * local Whisper only uses the interface language as a hint when unsure.
 */
export function dictationLanguage(value: VoiceSettings, locale: string): string {
  if (value.dictationLanguage !== "auto") return value.dictationLanguage;
  return value.dictationEngine === "local" ? locale.split("-")[0] : "";
}
