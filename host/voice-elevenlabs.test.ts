import { expect, it, vi } from "vitest";
import { ELEVENLABS_DEFAULT_VOICE, ELEVENLABS_MODEL, streamElevenLabs } from "./voice-elevenlabs";

function pcmResponse(parts: number[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of parts) controller.enqueue(new Uint8Array(size).fill(1));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

it("streams PCM16 in half-second chunks with the multilingual flash model", async () => {
  // Odd network boundaries: 30001 + 20000 + 5 bytes = 50006 -> 24000, 24000, 2006.
  const request = vi.fn(async () => pcmResponse([30001, 20000, 5]));
  const chunks: Buffer[] = [];
  await streamElevenLabs(
    { key: "key", text: "Merhaba", language: "tr", signal: new AbortController().signal, request },
    (pcm) => chunks.push(Buffer.from(pcm)),
  );
  expect(chunks.map((chunk) => chunk.length)).toEqual([24000, 24000, 2006]);
  const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_DEFAULT_VOICE}/stream?output_format=pcm_24000`,
  );
  expect(JSON.parse(String(init.body))).toEqual({
    text: "Merhaba",
    model_id: ELEVENLABS_MODEL,
    language_code: "tr",
  });
});

it("drops a stray final byte, which is not a whole PCM16 sample", async () => {
  const chunks: Buffer[] = [];
  await streamElevenLabs(
    {
      key: "key",
      text: "Hi",
      signal: new AbortController().signal,
      request: vi.fn(async () => pcmResponse([7])),
    },
    (pcm) => chunks.push(Buffer.from(pcm)),
  );
  expect(chunks.map((chunk) => chunk.length)).toEqual([6]);
});

it("omits unsupported language codes, uses a chosen voice and maps failures safely", async () => {
  const request = vi.fn(async () => new Response("secret detail", { status: 401 }));
  const failure = await streamElevenLabs(
    {
      key: "key",
      text: "Hi",
      voiceId: "Voice123",
      language: "xx",
      signal: new AbortController().signal,
      request,
    },
    () => {},
  ).catch((error: Error) => error);
  expect(String(failure)).toContain("rejected the API key");
  expect(String(failure)).not.toContain("secret detail");
  const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain("/text-to-speech/Voice123/stream");
  expect(JSON.parse(String(init.body)).language_code).toBeUndefined();
});

it("ends quietly when cancelled", async () => {
  const abort = new AbortController();
  const request = vi.fn(async () => {
    abort.abort();
    throw new DOMException("aborted", "AbortError");
  });
  const chunk = vi.fn();
  await expect(
    streamElevenLabs({ key: "key", text: "Hi", signal: abort.signal, request }, chunk),
  ).resolves.toBeUndefined();
  expect(chunk).not.toHaveBeenCalled();
});
