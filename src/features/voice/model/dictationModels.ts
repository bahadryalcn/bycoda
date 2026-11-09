/** Cloud speech-to-text providers for dictation. Shared by the settings UI and the Host. */
export type CloudDictationProvider = "openai" | "xai" | "openrouter";
export const CLOUD_DICTATION_PROVIDERS: readonly CloudDictationProvider[] = [
  "openai",
  "xai",
  "openrouter",
];
export const DICTATION_PROVIDER_NAMES: Record<CloudDictationProvider, string> = {
  openai: "OpenAI",
  xai: "Grok",
  openrouter: "OpenRouter",
};

/** Dictation languages by native name, so each speaker finds their own whatever the interface language. */
export const DICTATION_LANGUAGES = [
  ["tr", "Türkçe"],
  ["en", "English"],
  ["de", "Deutsch"],
  ["fr", "Français"],
  ["es", "Español"],
  ["pt", "Português"],
  ["zh", "简体中文"],
  ["ja", "日本語"],
] as const;

/**
 * Transcription models the owner can choose per provider; the first is the default.
 * The Host accepts only these, so a stored or forged value cannot pick another endpoint model.
 */
export const DICTATION_MODELS: Record<
  CloudDictationProvider,
  readonly { id: string; label: string }[]
> = {
  openai: [
    { id: "gpt-4o-mini-transcribe", label: "GPT-4o mini Transcribe" },
    { id: "gpt-4o-transcribe", label: "GPT-4o Transcribe" },
    { id: "whisper-1", label: "Whisper" },
  ],
  xai: [{ id: "grok-voice-transcribe-2.0", label: "Grok Voice Transcribe 2.0" }],
  openrouter: [
    { id: "openai/gpt-4o-mini-transcribe", label: "OpenAI GPT-4o mini Transcribe" },
    { id: "openai/gpt-4o-transcribe", label: "OpenAI GPT-4o Transcribe" },
    { id: "openai/gpt-transcribe", label: "OpenAI GPT Transcribe" },
    { id: "google/gemini-3.5-transcribe", label: "Google Gemini 3.5 Transcribe" },
    { id: "elevenlabs/scribe-v2", label: "ElevenLabs Scribe v2" },
    { id: "mistralai/voxtral-mini-transcribe-3-0", label: "Mistral Voxtral Mini Transcribe 3" },
    { id: "deepgram/nova-3", label: "Deepgram Nova-3" },
    { id: "x-ai/grok-stt-1.0", label: "xAI Grok STT 1.0" },
    { id: "openai/whisper-large-v3-turbo", label: "OpenAI Whisper large v3 turbo" },
  ],
};

/** The chosen model when the provider offers it, otherwise the provider default. */
export function dictationModel(provider: CloudDictationProvider, chosen: unknown): string {
  const models = DICTATION_MODELS[provider];
  return models.find((model) => model.id === chosen)?.id ?? models[0].id;
}
