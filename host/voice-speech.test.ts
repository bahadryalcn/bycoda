import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
const launch = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: launch.spawn }));
import { VoiceSpeechService } from "./voice-speech";
let service: VoiceSpeechService;
afterEach(() => {
  service?.close();
  vi.clearAllMocks();
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
