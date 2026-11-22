import { t } from "../../../shared/i18n";
import type { VoiceMode } from "./voiceSettings";

/** The one provider list, in one order, for the settings page and the setup step. */
export function voiceProviderOptions(): { value: VoiceMode; label: string }[] {
  return [
    { value: "local", label: t("Local") },
    // Signed in through Grok Build and Codex; no separate API key.
    { value: "grok", label: "Grok Voice" },
    { value: "openai", label: "OpenAI Realtime" },
  ];
}

export function voiceProviderLabel(mode: VoiceMode): string {
  return voiceProviderOptions().find((option) => option.value === mode)?.label ?? mode;
}
