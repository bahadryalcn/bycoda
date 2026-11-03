import { loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from "./voiceSettings";
import { chooseVoiceTurnEnd } from "./voiceTurnPolicy";

export const VOICE_PRESET_FAILED = "Conversation preset could not be saved. Try again.";

export function professionalConversationPreset(settings: VoiceSettings): VoiceSettings {
  return {
    ...chooseVoiceTurnEnd(settings, false),
    turnEndSilence: 2.5,
    allowBargeIn: true,
    holdAnnouncements: true,
  };
}

export function saveProfessionalConversationPreset(): void {
  const next = professionalConversationPreset(loadVoiceSettings());
  saveVoiceSettings(next);
  const saved = loadVoiceSettings();
  if (
    saved.manualTurnEnd !== false ||
    saved.manualTurnEndRevision !== next.manualTurnEndRevision ||
    saved.turnEndSilence !== 2.5 ||
    saved.allowBargeIn !== true ||
    saved.holdAnnouncements !== true
  ) {
    throw new Error(VOICE_PRESET_FAILED);
  }
}
