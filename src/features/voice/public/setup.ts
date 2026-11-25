import { useVoiceSettings, voiceRuntimeSettings } from "../model/voiceSettings";

export { VoiceSetupSteps } from "../ui/VoiceSetupSteps";

/** Scope connection evidence to the provider and runtime, independent of the preview speaker. */
export function useVoiceSetupProviderKey() {
  const settings = useVoiceSettings();
  const { voiceId: _voiceId, ...runtime } = voiceRuntimeSettings(settings);
  return JSON.stringify([settings.mode, settings.mode === "local" ? runtime : null]);
}
