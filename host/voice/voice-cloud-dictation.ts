import { validateVoiceAudio } from "./voice-local";
import { realtimeCredential } from "./voice";
import {
  CLOUD_DICTATION_PROVIDERS,
  DICTATION_MODELS,
  dictationModel,
  type CloudDictationProvider,
} from "../../src/features/voice/model/dictationModels";

const NAMES: Record<CloudDictationProvider, string> = {
  openai: "OpenAI",
  xai: "Grok",
  openrouter: "OpenRouter",
};
const SIGN_IN: Record<CloudDictationProvider, string> = {
  openai: "Sign in to Codex or set OPENAI_API_KEY on bycoda Host.",
  xai: "Sign in to Grok Build (grok login) or set XAI_API_KEY on bycoda Host.",
  openrouter: "Add an OpenRouter API key in Settings → Voice assistant.",
};

export type CloudDictationDeps = {
  /** Long-lived credential, read on the Host only; never returned to callers. */
  credential: (provider: CloudDictationProvider) => Promise<string | undefined>;
  request?: typeof fetch;
};

/** OpenAI/xAI use the same sign-in as realtime voice; OpenRouter uses the Host vault. */
export function cloudDictationCredential(
  openRouterKey: () => Promise<string | undefined>,
): CloudDictationDeps["credential"] {
  return (provider) => (provider === "openrouter" ? openRouterKey() : realtimeCredential(provider));
}

/** 16 kHz mono 16-bit PCM wrapped in a WAV container. */
export function pcmWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Transcribes one dictation phrase with a cloud speech-to-text API. Audio goes
 * only to the chosen provider; credentials and upstream bodies never reach the caller.
 */
export async function transcribeCloudDictation(
  provider: unknown,
  audio: unknown,
  language: unknown,
  deps: CloudDictationDeps,
  /** One of the provider's allowed models; omitted uses its default. */
  requestedModel?: unknown,
): Promise<{ text: string }> {
  if (!CLOUD_DICTATION_PROVIDERS.includes(provider as CloudDictationProvider))
    throw new Error("Invalid dictation provider.");
  const chosen = provider as CloudDictationProvider;
  if (
    requestedModel !== undefined &&
    !DICTATION_MODELS[chosen].some((entry) => entry.id === requestedModel)
  )
    throw new Error("Invalid dictation model.");
  const valid = validateVoiceAudio(audio, language);
  const name = NAMES[chosen];
  const credential = (await deps.credential(chosen).catch(() => undefined))?.trim();
  if (!credential) throw new Error(`${name} is not signed in. ${SIGN_IN[chosen]}`);
  const wav = pcmWav(Buffer.from(valid.audio, "base64"));
  const lang = typeof valid.language === "string" ? valid.language : undefined;
  const model = dictationModel(chosen, requestedModel);
  let init: RequestInit;
  let url: string;
  if (chosen === "openrouter") {
    url = "https://openrouter.ai/api/v1/audio/transcriptions";
    init = {
      method: "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input_audio: { data: wav.toString("base64"), format: "wav" },
        ...(lang ? { language: lang } : {}),
      }),
    };
  } else {
    const form = new FormData();
    form.set("model", model);
    if (lang) form.set("language", lang);
    // xAI ignores fields sent after the file, so it goes last.
    form.set("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "speech.wav");
    url =
      chosen === "xai"
        ? "https://api.x.ai/v1/stt"
        : "https://api.openai.com/v1/audio/transcriptions";
    init = { method: "POST", headers: { Authorization: `Bearer ${credential}` }, body: form };
  }
  let response: Response;
  try {
    response = await (deps.request ?? fetch)(url, { ...init, signal: AbortSignal.timeout(25_000) });
  } catch {
    throw new Error(`${name} could not be reached. Check the internet connection.`);
  }
  // Upstream bodies can echo credentials; report only the status.
  if (response.status === 401 || response.status === 403)
    throw new Error(`${name} sign-in was rejected (${response.status}). ${SIGN_IN[chosen]}`);
  if (!response.ok)
    throw new Error(`${name} speech recognition is unavailable (${response.status}).`);
  const result = (await response.json().catch(() => undefined)) as { text?: unknown } | undefined;
  if (typeof result?.text !== "string" || result.text.length > 16000)
    throw new Error(`${name} returned an invalid transcript.`);
  return { text: result.text };
}
