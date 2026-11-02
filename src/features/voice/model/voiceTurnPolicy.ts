import { loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from "./voiceSettings";

export const VOICE_TURN_CHOICE_FAILED = "Turn ending preference could not be saved. Try again.";

/** An explicit owner choice wins over any in-flight spoken-rule save. */
export function chooseVoiceTurnEnd(settings: VoiceSettings, manualTurnEnd: boolean): VoiceSettings {
  return {
    ...settings,
    manualTurnEnd,
    manualTurnEndRevision: (settings.manualTurnEndRevision ?? 0) + 1,
  };
}

/** Avoid enabling a manual runtime with no persisted, reachable Finish control. */
export function saveVoiceTurnEndChoice(manual: boolean): VoiceSettings {
  const next = chooseVoiceTurnEnd(loadVoiceSettings(), manual);
  saveVoiceSettings(next);
  const saved = loadVoiceSettings();
  if (saved.manualTurnEnd !== manual || saved.manualTurnEndRevision !== next.manualTurnEndRevision) {
    throw new Error(VOICE_TURN_CHOICE_FAILED);
  }
  return saved;
}
