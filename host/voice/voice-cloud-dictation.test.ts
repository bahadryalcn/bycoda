import { expect, it, vi } from "vitest";
import { pcmWav, transcribeCloudDictation } from "./voice-cloud-dictation";
import { cachedTranscriptionModels } from "./voice-transcription-catalog";

const AUDIO = Buffer.alloc(3200, 1).toString("base64");
const SECRET = "sk-" + "s".repeat(40);
const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const credential = vi.fn(async () => SECRET);

it("deduplicates phrase discovery, refreshes after a minute and never uses stale results after failure", async () => {
  let now = 0;
  let finish!: (value: { id: string; label: string }[]) => void;
  const load = vi.fn().mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const transcriptionModels = cachedTranscriptionModels(load, () => now);
  const request = vi.fn(async () => reply(200, { text: "ok" }));
  const deps = { credential, request: request as typeof fetch, transcriptionModels };
  const phrase = () => transcribeCloudDictation("openrouter", AUDIO, "tr", deps, "vendor/model");
  const first = phrase();
  const second = phrase();
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  finish([{ id: "vendor/model", label: "Model" }]);
  await Promise.all([first, second]);
  now = 59_999;
  await phrase();
  expect(load).toHaveBeenCalledTimes(1);
  now = 60_000;
  load.mockRejectedValueOnce(new Error("catalog offline"));
  await expect(phrase()).rejects.toThrow("catalog offline");
  expect(request).toHaveBeenCalledTimes(3);
  load.mockResolvedValueOnce([{ id: "vendor/model", label: "Model" }]);
  await phrase();
  expect(load).toHaveBeenCalledTimes(3);
  expect(request).toHaveBeenCalledTimes(4);
});

it("wraps 16 kHz mono PCM in a WAV header", () => {
  const wav = pcmWav(Buffer.alloc(320));
  expect(wav.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(wav.readUInt32LE(24)).toBe(16000);
  expect(wav.readUInt16LE(22)).toBe(1);
  expect(wav.readUInt32LE(40)).toBe(320);
  expect(wav.length).toBe(364);
});

it("sends a phrase to OpenAI and xAI as a WAV upload with the language, file last", async () => {
  for (const [provider, url, model] of [
    ["openai", "https://api.openai.com/v1/audio/transcriptions", "gpt-4o-mini-transcribe"],
    ["xai", "https://api.x.ai/v1/stt", "grok-voice-transcribe-2.0"],
  ] as const) {
    const request = vi.fn(async () => reply(200, { text: " Merhaba " }));
    const result = await transcribeCloudDictation(provider, AUDIO, "tr", {
      credential,
      request: request as typeof fetch,
    });
    expect(result).toEqual({ text: " Merhaba " });
    const [target, init] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe(url);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual(["model", "language", "file"]);
    expect(form.get("model")).toBe(model);
    expect(form.get("language")).toBe("tr");
    expect((form.get("file") as Blob).size).toBe(3244);
  }
});

it("sends a phrase to OpenRouter as base64 WAV JSON", async () => {
  const request = vi.fn(async () => reply(200, { text: "hello", usage: { seconds: 0.1 } }));
  await transcribeCloudDictation("openrouter", AUDIO, undefined, {
    credential,
    request: request as typeof fetch,
    transcriptionModels: async () => [{ id: "openai/gpt-4o-mini-transcribe", label: "Mini" }],
  });
  const [target, init] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(target).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
  const body = JSON.parse(String(init.body));
  expect(body.model).toBe("openai/gpt-4o-mini-transcribe");
  expect(body.input_audio.format).toBe("wav");
  expect(Buffer.from(body.input_audio.data, "base64").subarray(0, 4).toString()).toBe("RIFF");
  expect(body).not.toHaveProperty("language");
});

it("uses a chosen allowed model and rejects any other", async () => {
  const request = vi.fn(async () => reply(200, { text: "ok" }));
  const deps = {
    credential,
    request: request as typeof fetch,
    transcriptionModels: async () => [{ id: "deepgram/nova-3", label: "Nova" }],
  };
  await transcribeCloudDictation("openrouter", AUDIO, "tr", deps, "deepgram/nova-3");
  const [, init] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(init.body)).model).toBe("deepgram/nova-3");
  await expect(
    transcribeCloudDictation("openai", AUDIO, "tr", deps, "deepgram/nova-3"),
  ).rejects.toThrow("Invalid dictation model");
  expect(request).toHaveBeenCalledOnce();
  await expect(
    transcribeCloudDictation("openrouter", AUDIO, "tr", deps, "removed/model"),
  ).rejects.toThrow("no longer available");
  expect(request).toHaveBeenCalledOnce();
});

it("uses the current catalog default only when no model was selected", async () => {
  const request = vi.fn(async () => reply(200, { text: "ok" }));
  const deps = {
    credential,
    request: request as typeof fetch,
    transcriptionModels: async () => [{ id: "new/model", label: "New" }],
  };
  await transcribeCloudDictation("openrouter", AUDIO, "tr", deps);
  const [, init] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(init.body)).model).toBe("new/model");
  await expect(
    transcribeCloudDictation("openrouter", AUDIO, "tr", deps, "removed/model"),
  ).rejects.toThrow("no longer available");
  expect(request).toHaveBeenCalledOnce();
});

it("rejects bad input and missing sign-in before any request", async () => {
  const request = vi.fn();
  const deps = { credential, request: request as unknown as typeof fetch };
  await expect(transcribeCloudDictation("other", AUDIO, "tr", deps)).rejects.toThrow(
    "Invalid dictation provider",
  );
  await expect(transcribeCloudDictation("openai", "abc", "tr", deps)).rejects.toThrow(
    "Invalid voice audio",
  );
  await expect(
    transcribeCloudDictation("openrouter", AUDIO, "tr", {
      credential: async () => undefined,
      request: request as unknown as typeof fetch,
    }),
  ).rejects.toThrow("OpenRouter is not signed in");
  expect(request).not.toHaveBeenCalled();
});

it("reports only upstream statuses, never bodies or credentials", async () => {
  const echo = { error: `bad key ${SECRET}` };
  for (const [status, message] of [
    [401, "sign-in was rejected (401)"],
    [500, "unavailable (500)"],
  ] as const) {
    const failure = await transcribeCloudDictation("xai", AUDIO, "tr", {
      credential,
      request: (async () => reply(status, echo)) as typeof fetch,
    }).catch((error: Error) => error);
    expect(String(failure)).toContain(message);
    expect(String(failure)).not.toContain(SECRET);
  }
  const offline = await transcribeCloudDictation("openai", AUDIO, "tr", {
    credential,
    request: (async () => {
      throw new Error(`network ${SECRET}`);
    }) as typeof fetch,
  }).catch((error: Error) => error);
  expect(String(offline)).toContain("could not be reached");
  expect(String(offline)).not.toContain(SECRET);
});
