import { HttpStreamScope } from "./http-stream-scope";
import { voicePlaybackTimeoutMs } from "../src/features/voice/model/voicePlaybackDeadline";
/** ElevenLabs reply voice: only the reply text is sent; PCM streams back. */
export const ELEVENLABS_MODEL = "eleven_flash_v2_5";
/** "George", a default (premade) voice available to every account; multilingual models
 * speak all their languages with it. */
export const ELEVENLABS_DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";
export const ELEVENLABS_SAMPLE_RATE = 24_000;
/** Half a second of 16-bit mono PCM per protocol chunk. */
const CHUNK_BYTES = ELEVENLABS_SAMPLE_RATE;
/** Flash v2.5 languages (ISO 639-1). Other codes are not sent, so the model detects them. */
const LANGUAGES = new Set(
  "en ja zh de hi fr ko pt it es id nl tr pl sv bg ro ar cs el fi hr ms sk da ta uk ru hu no vi".split(
    " ",
  ),
);

export async function streamElevenLabs(
  options: {
    key: string;
    text: string;
    voiceId?: string;
    language?: string;
    signal: AbortSignal;
    request?: typeof fetch;
  },
  chunk: (pcm: Buffer) => void,
): Promise<void> {
  const scope = new HttpStreamScope(options.signal, {
    firstMs: 30_000, idleMs: 15_000,
    totalMs: 30_000 + voicePlaybackTimeoutMs(options.text), label: "ElevenLabs",
  });
  try {
    const voice = options.voiceId || ELEVENLABS_DEFAULT_VOICE;
    let response: Response;
    try {
      response = await scope.request((signal) => (options.request ?? fetch)(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=pcm_24000`,
        {
          method: "POST",
          headers: { "xi-api-key": options.key, "Content-Type": "application/json" },
          body: JSON.stringify({
            text: options.text,
            model_id: ELEVENLABS_MODEL,
            ...(options.language && LANGUAGES.has(options.language)
              ? { language_code: options.language }
              : {}),
          }),
          signal,
        },
      ));
    } catch (error) {
      if (options.signal.aborted) return;
      throw new Error("ElevenLabs could not be reached. Check the connection and try again.", {
        cause: error,
      });
    }
    if (!response.ok || !response.body) throw new Error(elevenLabsFailure(response.status));
    let pending = Buffer.alloc(0);
    scope.body(response);
    try {
      while (true) {
        const { done, value } = await scope.read();
        if (done) break;
        pending = Buffer.concat([pending, Buffer.from(value)]);
        while (pending.length >= CHUNK_BYTES && !scope.signal.aborted) {
          chunk(pending.subarray(0, CHUNK_BYTES));
          pending = pending.subarray(CHUNK_BYTES);
        }
      }
    } catch (error) {
      if (options.signal.aborted) return;
      throw new Error("ElevenLabs stopped while speaking. Try again.", { cause: error });
    }
    // PCM16 needs whole samples; a stray final byte cannot be played.
    const whole = pending.subarray(0, pending.length - (pending.length % 2));
    if (whole.length && !scope.signal.aborted) chunk(whole);
  } finally {
    scope.close();
  }
}

function elevenLabsFailure(status: number): string {
  if (status === 401 || status === 403)
    return "ElevenLabs rejected the API key. Update it in Chat settings.";
  if (status === 402) return "ElevenLabs has no credits left for this account.";
  if (status === 404) return "The ElevenLabs voice was not found. Choose another voice ID.";
  if (status === 429) return "ElevenLabs is busy or over its limit. Try again shortly.";
  return `ElevenLabs could not speak this reply (${status}).`;
}
