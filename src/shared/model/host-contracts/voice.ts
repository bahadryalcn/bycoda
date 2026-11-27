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

/** Host capability: the phone call's Grok Voice / OpenAI Realtime runs on this computer. */
export const VOICE_REALTIME_RELAY_CAPABILITY = "voice.realtime.relay.v1";
/**
 * Host capability: the relay takes spoken barge-in (`duplex`, `playedMs`), typed turns
 * (`voice.realtime.text`) and renews the provider session transparently near its time cap.
 */
export const VOICE_REALTIME_RELAY_V2_CAPABILITY = "voice.realtime.relay.v2";
/** A message typed during a realtime call. */
export const VOICE_RELAY_TEXT_MAX = 4_000;
/** The phone streams 16 kHz PCM16 up; the provider's 24 kHz PCM16 comes back down. */
export const VOICE_RELAY_IN_RATE = 16000;
export const VOICE_RELAY_OUT_RATE = 24000;
/** One uplink frame: base64 of at most 64 KiB PCM16 (about 2 s at 16 kHz). */
export const VOICE_RELAY_MAX_AUDIO_BASE64 = Math.ceil(65_536 / 3) * 4;
export const VOICE_CALL_MODES = ["local", "grok", "openai"] as const;
export type VoiceCallMode = (typeof VOICE_CALL_MODES)[number];
/** Bounds of the persisted call settings; the Host validates speakers against its own list. */
export const VOICE_CALL_PERSONA_MAX = 600;
export const VOICE_CALL_END_SILENCE = { min: 0.6, max: 4 } as const;

const VoiceCallSettingsPatchSchema = z.strictObject({
  mode: z.enum(VOICE_CALL_MODES).optional(),
  grokVoice: z.string().min(1).max(32).optional(),
  openaiVoice: z.string().min(1).max(32).optional(),
  languageLock: z.string().min(1).max(32).optional(),
  persona: z.string().max(VOICE_CALL_PERSONA_MAX).optional(),
  turnEndSilence: z
    .number()
    .min(VOICE_CALL_END_SILENCE.min)
    .max(VOICE_CALL_END_SILENCE.max)
    .optional(),
});
export type VoiceCallSettingsPatch = z.infer<typeof VoiceCallSettingsPatchSchema>;
export const VoiceCallSettingsSchema = z.strictObject({
  mode: z.enum(VOICE_CALL_MODES),
  grokVoice: z.string().min(1).max(32),
  openaiVoice: z.string().min(1).max(32),
  languageLock: z.string().min(1).max(32),
  persona: z.string().max(VOICE_CALL_PERSONA_MAX),
  turnEndSilence: z.number().min(VOICE_CALL_END_SILENCE.min).max(VOICE_CALL_END_SILENCE.max),
});
export type VoiceCallSettings = z.infer<typeof VoiceCallSettingsSchema>;
/** Settings plus read-only sign-in state; never keys, model ids or paths. */
export const VoiceCallSettingsResultSchema = z.strictObject({
  settings: VoiceCallSettingsSchema,
  signedIn: z.strictObject({ grok: z.boolean(), openai: z.boolean() }),
});
export type VoiceCallSettingsResult = z.infer<typeof VoiceCallSettingsResultSchema>;

const relayEvent = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("state"),
    at: z.number().int().nonnegative(),
    state: z.enum(["listening", "thinking", "speaking"]),
  }),
  z.strictObject({
    type: z.enum(["user_transcript", "assistant_transcript"]),
    at: z.number().int().nonnegative(),
    text: z.string().max(16_000),
    responseId: z.string().max(200).optional(),
  }),
  z.strictObject({ type: z.literal("interrupted"), at: z.number().int().nonnegative() }),
  z.strictObject({
    type: z.literal("ended"),
    at: z.number().int().nonnegative(),
    reason: z.enum(["ended", "idle", "revoked", "provider", "replaced", "expired", "stopping"]),
    message: z.string().max(500).optional(),
  }),
]);
export type VoiceRelayEvent = z.infer<typeof relayEvent>;
export const VoiceRelayNextResultSchema = z.strictObject({
  chunks: z
    .array(
      z.strictObject({
        at: z.number().int().nonnegative(),
        audio: z.string().min(1).max(1_000_000),
        responseId: z.string().max(200),
      }),
    )
    .max(256),
  events: z.array(relayEvent).max(256),
  cursor: z.number().int().nonnegative(),
});
export type VoiceRelayNextResult = z.infer<typeof VoiceRelayNextResultSchema>;

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
  "voice.realtime.start": {
    params: z.strictObject({
      threadId: id,
      provider: z.enum(["xai", "openai"]),
      language,
      /** The phone's captured thread project; the Host re-reads the thread's own binding. */
      projectId: id.optional(),
      /**
       * `false`: the phone has no echo cancellation, so its uplink is ignored while a reply plays
       * (half-duplex, tap to interrupt). Omitted or `true`: speaking over a reply interrupts it.
       */
      duplex: z.boolean().optional(),
    }),
    result: z.strictObject({
      lease: id,
      inRate: z.literal(VOICE_RELAY_IN_RATE),
      outRate: z.literal(VOICE_RELAY_OUT_RATE),
    }),
  },
  "voice.realtime.audio": {
    params: z.strictObject({
      lease: id,
      seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      audio: z.string().min(1).max(VOICE_RELAY_MAX_AUDIO_BASE64),
      /** Milliseconds of the reply in progress the phone has played; a barge-in truncates there. */
      playedMs: z.number().int().nonnegative().max(3_600_000).optional(),
    }),
    result: JsonValueSchema,
  },
  /** A message typed during the call: the next turn, queued behind a reply in flight. */
  "voice.realtime.text": {
    params: z.strictObject({ lease: id, text: z.string().min(1).max(VOICE_RELAY_TEXT_MAX) }),
    result: z.strictObject({ queued: z.boolean() }),
  },
  "voice.realtime.next": {
    params: z.strictObject({ lease: id, cursor: z.number().int().nonnegative() }),
    result: VoiceRelayNextResultSchema,
  },
  "voice.realtime.interrupt": {
    params: z.strictObject({
      lease: id,
      playedMs: z.number().int().nonnegative().max(3_600_000),
    }),
    result: JsonValueSchema,
  },
  "voice.realtime.end": { params: lease, result: JsonValueSchema },
  "voice.call.settings.get": { params: z.strictObject({}), result: VoiceCallSettingsResultSchema },
  "voice.call.settings.set": {
    params: VoiceCallSettingsPatchSchema,
    result: VoiceCallSettingsResultSchema,
  },
} as const;
export type VoiceMethod = keyof typeof VOICE_RPC_SCHEMAS;
