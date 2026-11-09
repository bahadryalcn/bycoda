import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
const launch = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: launch.spawn }));
import { VoiceSpeechService } from "./voice-speech";
let service: VoiceSpeechService;
afterEach(() => {
  service?.close();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("ends a silent worker and ignores audio arriving after its deadline", async () => {
  vi.useFakeTimers();
  const child = worker();
  service = new VoiceSpeechService();
  const loading = service.start({ python: "python", ttsPath: "models" });
  child.stdout.write('{"ready":true}\n');
  await loading;
  const { id } = service.speak("one", "Merhaba");
  await vi.advanceTimersByTimeAsync(30_001);
  child.stdout.write(JSON.stringify({ id, audio: "AAAA", sampleRate: 48000 }) + "\n");
  expect(await service.next("one", id)).toEqual({
    done: true,
    error: "Speech playback timed out. Try again.",
  });
  await expect(service.next("one", id)).rejects.toThrow("expired");
});
function worker() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  launch.spawn.mockReturnValue(child);
  return child;
}
it("streams PCM only to the owning lease and cancels a waiting reader on release", async () => {
  const child = worker();
  service = new VoiceSpeechService();
  const loading = service.start({ python: "python", ttsPath: "models" });
  child.stdout.write(JSON.stringify({ ready: true }) + "\n");
  await loading;
  const { id } = service.speak("one", "Merhaba");
  await expect(service.next("two", id)).rejects.toThrow("expired");
  expect(() => service.speak("two", "Hello")).toThrow("another window");
  const next = service.next("one", id);
  child.stdout.write(JSON.stringify({ id, audio: "AAAA", sampleRate: 48000 }) + "\n");
  expect(await next).toEqual({ audio: "AAAA", sampleRate: 48000 });
  const waiting = service.next("one", id);
  service.release("one");
  expect(await waiting).toEqual({ done: true });
  await expect(service.next("one", id)).rejects.toThrow("expired");
  expect(launch.spawn.mock.calls[0][2].windowsHide).toBe(true);
});
it("bounds generated text and fails pending readers when the worker exits", async () => {
  const child = worker();
  service = new VoiceSpeechService();
  const loading = service.start({ python: "python", ttsPath: "models" });
  child.stdout.write('{"ready":true}\n');
  await loading;
  expect(() => service.speak("one", "x".repeat(701))).toThrow("Invalid speech");
  const { id } = service.speak("one", "Merhaba");
  const next = service.next("one", id);
  child.emit("exit", 1);
  expect(await next).toEqual({ done: true, error: "Local voice disconnected." });
});

it("speaks through ElevenLabs without a Python worker and requires a stored key", async () => {
  service = new VoiceSpeechService({ cloudKey: async () => undefined });
  await expect(service.start({ natural: true, engine: "elevenlabs" })).rejects.toThrow(
    "Add your ElevenLabs API key",
  );
  const request = vi.fn(
    async (_url: unknown, _init?: RequestInit) =>
      new Response(new Uint8Array(48000 + 10), { status: 200 }),
  );
  service = new VoiceSpeechService({
    cloudKey: async () => "key",
    request: request as unknown as typeof fetch,
  });
  await service.start({ natural: true, engine: "elevenlabs", voiceId: "Voice123" });
  expect(launch.spawn).not.toHaveBeenCalled();
  const { id } = service.speak("one", "Merhaba", "tr");
  expect(String(request.mock.calls[0][0])).toContain("/Voice123/stream");
  expect(await service.next("one", id)).toMatchObject({ sampleRate: 24000 });
  expect(await service.next("one", id)).toMatchObject({ sampleRate: 24000 });
  const last = await service.next("one", id);
  expect(Buffer.from(last.audio!, "base64")).toHaveLength(10);
  expect(await service.next("one", id)).toEqual({ done: true });
  // A newer utterance from the same owner aborts the previous stream.
  service.speak("one", "Bir");
  service.speak("one", "İki");
  expect(request.mock.calls[1][1]?.signal?.aborted).toBe(true);
  expect(request.mock.calls[2][1]?.signal?.aborted).toBe(false);
});

it("reports ElevenLabs failures as a final chunk without leaking details", async () => {
  service = new VoiceSpeechService({
    cloudKey: async () => "key",
    request: (async () => new Response("quota for key", { status: 402 })) as typeof fetch,
  });
  await service.start({ natural: true, engine: "elevenlabs" });
  const { id } = service.speak("one", "Merhaba");
  expect(await service.next("one", id)).toEqual({
    done: true,
    error: "ElevenLabs has no credits left for this account.",
  });
});
