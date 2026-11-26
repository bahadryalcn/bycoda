import { voiceLanguageCode } from "./voiceLanguage";
import { voiceTranscriptionHint } from "./voiceFeatureLexicon";

/** Cloud speech-to-speech providers: xAI Grok Voice and OpenAI Realtime. */
export type RealtimeProvider = "xai" | "openai";

/** Both providers exchange 24 kHz mono PCM16. */
export const REALTIME_AUDIO_RATE = 24000;

/** OpenAI output speed (0.25–1.5). */
export const REALTIME_SPEECH_SPEED = 1.1;

export type RealtimeSessionOptions<Tools = readonly unknown[]> = {
  provider: RealtimeProvider;
  model: string;
  /** Interface language; the transcription hint falls back to it. */
  language: string;
  instructions: string;
  tools: Tools;
  voice?: string;
  languageLock?: string;
  experimentalSemanticVad?: boolean;
};

/**
 * The `session.update` payload. The client commits candidate audio and explicitly authorizes
 * each response: provider turn detection never starts or interrupts a reply on its own.
 */
export function realtimeSessionPayload<Tools>({
  provider,
  model,
  language,
  instructions,
  tools,
  voice,
  languageLock = "auto",
  experimentalSemanticVad = false,
}: RealtimeSessionOptions<Tools>) {
  const audioFormat = { type: "audio/pcm", rate: REALTIME_AUDIO_RATE };
  if (provider === "openai")
    return {
      type: "realtime",
      model,
      instructions,
      output_modalities: ["audio"],
      tools,
      tool_choice: "auto",
      audio: {
        input: {
          format: audioFormat,
          noise_reduction: { type: "near_field" },
          transcription: {
            model: "gpt-4o-mini-transcribe",
            // Optional vocabulary hint supported by the current transcription model.
            // No private target names and no replacement of recognized owner speech.
            prompt: voiceTranscriptionHint(voiceLanguageCode(languageLock) ?? language),
            ...(voiceLanguageCode(languageLock)
              ? { language: voiceLanguageCode(languageLock) }
              : {}),
          },
          turn_detection: experimentalSemanticVad
            ? {
                type: "semantic_vad",
                eagerness: "auto",
                create_response: false,
                interrupt_response: false,
              }
            : null,
        },
        // Default 1.0 sounds slow in conversation, especially outside English.
        output: { format: audioFormat, voice: voice || "marin", speed: REALTIME_SPEECH_SPEED },
      },
    };
  return {
    instructions,
    voice: voice || "eve",
    reasoning: { effort: "none" },
    turn_detection: { type: null },
    tools,
    audio: { input: { format: audioFormat }, output: { format: audioFormat } },
  };
}
