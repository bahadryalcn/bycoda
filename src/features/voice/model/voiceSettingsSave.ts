import {
  loadVoiceSettings,
  normalizeVoiceSettings,
  saveVoiceSettings,
  type VoiceSettings,
} from "./voiceSettings";

type Failure = { retry: () => void };
let failures: Record<string, Failure> = {};
const listeners = new Set<() => void>();
export const voiceSaveFailures = {
  get: () => failures,
  clear: () => {
    failures = {};
    listeners.forEach((listener) => listener());
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** UI-only outcome check. Keep the existing void writers and their runtime contracts intact. */
export function saveVoicePreference(id: string, write: () => void, matches: () => boolean) {
  let saved = false;
  try {
    write();
    saved = matches();
  } catch {
    /* Retain initiating action for explicit retry. */
  }
  const next = { ...failures };
  if (saved) delete next[id];
  else
    next[id] = {
      retry: () => {
        saveVoicePreference(id, write, matches);
      },
    };
  failures = next;
  listeners.forEach((listener) => listener());
  return saved;
}

const rowIds: Partial<Record<keyof VoiceSettings, string>> = {
  enabled: "voice-companion",
  mode: "voice-mode",
  natural: "voice-engine",
  engine: "voice-engine",
  elevenVoice: "voice-elevenlabs-voice",
  speakers: "voice-speaker",
  device: "voice-device",
  microphoneId: "voice-microphone-input",
  visual: "voice-visual-style",
  turnEndSilence: "voice-turn-silence",
  allowBargeIn: "voice-barge-in",
  holdAnnouncements: "voice-hold-announcements",
  idleSleepMinutes: "voice-idle-sleep",
  returnCall: "voice-return-call",
  returnCallSeconds: "voice-return-call-seconds",
  wakeEnabled: "voice-wake",
  wakePhrase: "voice-wake-phrase",
  sleepPhrase: "voice-sleep-phrase",
  experimentalSemanticVad: "voice-semantic-vad",
  dictationEnabled: "dictation-enabled",
  dictationLanguage: "dictation-language",
  dictationEngine: "dictation-engine",
  dictationModels: "dictation-model",
  dictationLocalModelPath: "dictation-local-models",
  dictationShortcutMode: "dictation-shortcut-mode",
  dictationIdleUnloadMinutes: "dictation-idle-unload",
  dictationSilenceFilter: "dictation-silence-filter",
  dictationRemoveFillers: "dictation-remove-fillers",
  python: "voice-python",
  whisperPath: "voice-whisper",
  ttsPath: "voice-tts",
};
const cleanupRows = {
  enabled: "dictation-cleanup",
  model: "dictation-cleanup-model",
  instructions: "dictation-cleanup-instructions",
  correctionCue: "dictation-correction-cue",
  translateToEnglish: "dictation-translate",
} as const;

/** Retry merges only the attempted patch into the latest preferences, preserving sibling changes. */
export function saveVoiceSettingsPatch(patch: Partial<VoiceSettings>) {
  const previous = loadVoiceSettings();
  const key = Object.keys(patch)[0] as keyof VoiceSettings;
  const cleanupKey =
    patch.dictationCleanup &&
    (Object.keys(cleanupRows) as (keyof typeof cleanupRows)[]).find(
      (key) => patch.dictationCleanup![key] !== previous.dictationCleanup[key],
    );
  const id = cleanupKey ? cleanupRows[cleanupKey] : rowIds[key];
  const expected = normalizeVoiceSettings({ ...previous, ...patch });
  const nested = ["speakers", "dictationModels", "dictationCleanup"] as const;
  const edits = Object.fromEntries(
    nested
      .filter((key) => patch[key])
      .map((key) => [
        key,
        Object.fromEntries(
          Object.entries(patch[key]!).filter(
            ([field, value]) => value !== (previous[key] as Record<string, unknown>)[field],
          ),
        ),
      ]),
  );
  const write = () => {
    const latest = loadVoiceSettings();
    saveVoiceSettings({
      ...latest,
      ...patch,
      ...Object.fromEntries(
        Object.entries(edits).map(([key, values]) => [
          key,
          { ...latest[key as (typeof nested)[number]], ...values },
        ]),
      ),
    });
  };
  const matches = () => {
    const saved = loadVoiceSettings();
    return (Object.keys(patch) as (keyof VoiceSettings)[]).every((key) =>
      edits[key]
        ? Object.keys(edits[key]).every(
            (field) =>
              (saved[key] as Record<string, unknown>)[field] ===
              (expected[key] as Record<string, unknown>)[field],
          )
        : JSON.stringify(saved[key]) === JSON.stringify(expected[key]),
    );
  };
  // Dictionary owns its explicit editor, revision comparison and retry.
  if (!id) {
    write();
    return matches();
  }
  return saveVoicePreference(id, write, matches);
}
