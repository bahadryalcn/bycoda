// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({
  start: vi.fn(async () => ({ lease: "dictation", model: "large-v3-turbo", device: "cuda" })),
  release: vi.fn(async () => {}),
  transcribe: vi.fn(),
  keepAlive: vi.fn(async () => ({ ready: true })),
}));
vi.mock("./localVoiceClient", () => ({ localVoiceBackend: backend }));
import { Dictation } from "./dictation";
/** A voiced (150 Hz) speech-like frame: the VAD requires pitch, not just level. */
const voicedFrame = () =>
  Int16Array.from({ length: 1024 }, (_, i) =>
    Math.round(4000 * Math.sin((2 * Math.PI * 150 * i) / 16000)),
  );

const track = { stop: vi.fn() };
let port: { onmessage: ((event: { data: ArrayBuffer }) => void) | null };
function setup() {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), port: { onmessage: null } });
  vi.stubGlobal(
    "AudioContext",
    class {
      sampleRate = 16000;
      state = "running";
      destination = {};
      audioWorklet = { addModule: vi.fn(async () => {}) };
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {
        this.state = "closed";
      });
      createMediaStreamSource = vi.fn(node);
    },
  );
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      constructor() {
        const value = node();
        port = value.port;
        return value;
      }
    },
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
  });
  const events = { text: vi.fn(), state: vi.fn(), error: vi.fn() };
  return events;
}
const speak = (frames = 5) => {
  for (let i = 0; i < frames; i++) port.onmessage!({ data: voicedFrame().buffer });
};
const pause = () => {
  for (let i = 0; i < 10; i++) port.onmessage!({ data: new Int16Array(1024).buffer });
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("starts recognition only and inserts phrases in spoken order with the app language", async () => {
  const events = setup();
  let finishFirst!: (value: unknown) => void;
  backend.transcribe
    .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
    .mockResolvedValueOnce({ text: "ikinci cümle", language: "tr", inferenceMs: 90 });
  const dictation = new Dictation(events, "tr", { natural: true });
  await dictation.start();
  // `true`: the Host shares the recognizer without loading natural speech.
  expect(backend.start).toHaveBeenCalledWith({ natural: true }, true);
  expect(events.state).toHaveBeenLastCalledWith("listening");
  speak();
  pause();
  speak();
  pause();
  expect(backend.transcribe).toHaveBeenCalledTimes(2);
  expect(backend.transcribe).toHaveBeenCalledWith("dictation", expect.any(String), "tr");
  finishFirst({ text: " Merhaba dünya ", language: "tr", inferenceMs: 120 });
  await vi.waitFor(() => expect(events.text).toHaveBeenCalledTimes(2));
  expect(events.text.mock.calls).toEqual([["Merhaba dünya"], ["ikinci cümle"]]);
});

it("transcribes the unfinished phrase on stop, then releases the microphone and lease", async () => {
  const events = setup();
  backend.transcribe.mockResolvedValueOnce({ text: "son kelime", language: "tr", inferenceMs: 80 });
  const dictation = new Dictation(events, "tr");
  await dictation.start();
  speak();
  await dictation.stop();
  expect(events.state).toHaveBeenCalledWith("finishing");
  expect(events.text).toHaveBeenCalledWith("son kelime");
  expect(track.stop).toHaveBeenCalled();
  expect(backend.release).toHaveBeenCalledWith("dictation");
  expect(events.state).toHaveBeenLastCalledWith("idle");
});

it("reports a start failure and leaves nothing running", async () => {
  const events = setup();
  backend.start.mockRejectedValueOnce("Voice setup is incomplete: Whisper model.");
  await new Dictation(events, "tr").start();
  expect(events.error).toHaveBeenCalledWith("Voice setup is incomplete: Whisper model.");
  expect(events.state).toHaveBeenLastCalledWith("idle");
  expect(backend.release).not.toHaveBeenCalled();
});
