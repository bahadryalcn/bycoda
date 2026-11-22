import { z } from "zod";
import { JsonObjectSchema, JsonValueSchema } from "./schemas";

/**
 * The paired phone's voice call over its native Host socket: listen through this computer's local
 * recognizer or its cloud transcription key, and read replies aloud with the local synthesizer.
 * Setup, model management and keys stay on the computer's own owner RPC.
 */
export const VOICE_CAPABILITY = "transport.ws.voice.v1";

const id = z.string().min(1).max(200);
const language = z.string().min(1).max(32).optional();
/**
 * One utterance of 16 kHz PCM, base64; the 1 MiB socket frame bounds it (about 23 s). The voice
 * services decode and validate the audio itself, and the phone validates every result.
 */
const audio = z.string().min(1).max(1_000_000);
const lease = z.strictObject({ lease: id });

export const VOICE_RPC_SCHEMAS = {
  "voice.local.start": {
    params: z.strictObject({
      config: JsonObjectSchema.optional(),
      recognitionOnly: z.boolean().optional(),
    }),
    result: JsonValueSchema,
  },
  "voice.local.transcribe": {
    params: z.strictObject({ lease: id, audio, language, endpoint: z.boolean().optional() }),
    result: JsonValueSchema,
  },
  "voice.cloud.transcribe": {
    params: z.strictObject({
      provider: z.enum(["openrouter", "openai", "xai"]),
      audio,
      language,
      model: z.string().min(1).max(200).optional(),
    }),
    result: JsonValueSchema,
  },
  "voice.local.speak": {
    params: z.strictObject({ lease: id, text: z.string().min(1).max(4_000), language }),
    result: JsonValueSchema,
  },
  "voice.local.speechNext": { params: z.strictObject({ lease: id, id }), result: JsonValueSchema },
  "voice.local.keepAlive": { params: lease, result: JsonValueSchema },
  "voice.local.release": { params: lease, result: JsonValueSchema },
} as const;
export type VoiceMethod = keyof typeof VOICE_RPC_SCHEMAS;
