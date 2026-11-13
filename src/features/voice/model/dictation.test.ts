// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({
  start: vi.fn(async () => ({ lease: "dictation", model: "large-v3-turbo", device: "cuda" })),
  release: vi.fn(async () => {}),
  transcribe: vi.fn(),
  keepAlive: vi.fn(async () => ({ ready: true })),
  cloudTranscribe: vi.fn(),
  processDictation: vi.fn(),
  cancelDictationCleanup: vi.fn(async () => {}),
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
  // Both phrases are recognized concurrently; the first still arrives first.
  await vi.waitFor(() => expect(backend.transcribe).toHaveBeenCalledTimes(2));
  expect(backend.transcribe).toHaveBeenCalledWith("dictation", expect.any(String), "tr");
  finishFirst({ text: " Merhaba dünya ", language: "tr", inferenceMs: 120 });
  await vi.waitFor(() => expect(events.text).toHaveBeenCalledTimes(2));
  expect(events.text.mock.calls).toEqual([
    ["Merhaba dünya", true],
    ["ikinci cümle", true],
  ]);
});

it("transcribes the unfinished phrase on stop, then releases the microphone and lease", async () => {
  const events = setup();
  backend.transcribe.mockResolvedValueOnce({ text: "son kelime", language: "tr", inferenceMs: 80 });
  const dictation = new Dictation(events, "tr");
  await dictation.start();
  speak();
  await dictation.stop();
  expect(events.state).toHaveBeenCalledWith("finishing");
  expect(events.text).toHaveBeenCalledWith("son kelime", true);
  expect(track.stop).toHaveBeenCalled();
  expect(backend.release).toHaveBeenCalledWith("dictation");
  expect(events.state).toHaveBeenLastCalledWith("idle");
});

it("captures the selected input used by the microphone permission check", async () => {
  const events = setup();
  const dictation = new Dictation(events, "tr", { natural: false }, "selected-mic");
  await dictation.start();
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      deviceId: { exact: "selected-mic" },
    },
    video: false,
  });
  dictation.cancel();
  expect(track.stop).toHaveBeenCalled();
});

it("reports a start failure and leaves nothing running", async () => {
  const events = setup();
  backend.start.mockRejectedValueOnce("Voice setup is incomplete: Whisper model.");
  await new Dictation(events, "tr").start();
  expect(events.error).toHaveBeenCalledWith("Voice setup is incomplete: Whisper model.");
  expect(events.state).toHaveBeenLastCalledWith("idle");
  expect(events.error).toHaveBeenCalledOnce();
  expect(backend.release).not.toHaveBeenCalled();
  // The microphone opened alongside the recognizer is closed again.
  expect(track.stop).toHaveBeenCalled();
});

it("buffers speech while the recognizer loads and reports listening once it is ready", async () => {
  const events = setup();
  let ready!: (value: { lease: string; model: string; device: string }) => void;
  backend.start.mockImplementationOnce(() => new Promise((resolve) => (ready = resolve)));
  backend.transcribe
    .mockResolvedValueOnce({ text: "bir", language: "tr", inferenceMs: 90 })
    .mockResolvedValueOnce({ text: "iki", language: "tr", inferenceMs: 90 })
    .mockResolvedValueOnce({ text: "üç", language: "tr", inferenceMs: 90 });
  const dictation = new Dictation(events, "tr");
  await dictation.start();
  // The button keeps showing preparation instead of a listening state that types nothing.
  expect(events.state).toHaveBeenLastCalledWith("starting");
  for (let i = 0; i < 3; i++) {
    speak();
    pause();
  }
  await Promise.resolve();
  expect(backend.transcribe).not.toHaveBeenCalled();
  ready({ lease: "dictation", model: "large-v3-turbo", device: "cuda" });
  await vi.waitFor(() => expect(events.text).toHaveBeenCalledTimes(3));
  expect(events.state).toHaveBeenCalledWith("listening");
  expect(events.text.mock.calls).toEqual([
    ["bir", true],
    ["iki", true],
    ["üç", true],
  ]);
  expect(events.error).not.toHaveBeenCalled();
});

it("keeps at most two recognitions in flight", async () => {
  const events = setup();
  const finish: ((value: unknown) => void)[] = [];
  backend.transcribe.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  const dictation = new Dictation(events, "tr");
  await dictation.start();
  for (let i = 0; i < 3; i++) {
    speak();
    pause();
  }
  await vi.waitFor(() => expect(backend.transcribe).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(backend.transcribe).toHaveBeenCalledTimes(2);
  finish[0]({ text: "bir", language: "tr", inferenceMs: 1 });
  await vi.waitFor(() => expect(backend.transcribe).toHaveBeenCalledTimes(3));
  backend.transcribe.mockReset();
  dictation.cancel();
});

it("releases a lease that arrives after dictation was cancelled while loading", async () => {
  const events = setup();
  let ready!: (value: { lease: string; model: string; device: string }) => void;
  backend.start.mockImplementationOnce(() => new Promise((resolve) => (ready = resolve)));
  const dictation = new Dictation(events, "tr");
  await dictation.start();
  dictation.cancel();
  expect(track.stop).toHaveBeenCalled();
  ready({ lease: "late", model: "small", device: "cpu" });
  await vi.waitFor(() => expect(backend.release).toHaveBeenCalledWith("late"));
  expect(events.error).not.toHaveBeenCalled();
  expect(events.state).toHaveBeenLastCalledWith("idle");
});

it("reports real microphone level, silence and zero on stop without accepting stale audio", async () => {
  const events = { ...setup(), level: vi.fn() };
  const dictation = new Dictation(events, "tr");
  await dictation.start();
  const captured = port.onmessage!;
  captured({ data: voicedFrame().buffer });
  expect(events.level.mock.lastCall?.[0]).toBeGreaterThan(0.05);
  expect(events.level.mock.lastCall?.[0]).toBeLessThan(1);
  captured({ data: new Int16Array(1024).buffer });
  expect(events.level).toHaveBeenLastCalledWith(0);
  dictation.cancel();
  expect(events.level).toHaveBeenLastCalledWith(0);
  events.level.mockClear();
  captured({ data: voicedFrame().buffer });
  expect(events.level).not.toHaveBeenCalled();
});

it("keeps the lease alive while stop drains and clears the heartbeat afterwards", async () => {
  vi.useFakeTimers();
  try {
    const events = setup();
    let finish!: (value: unknown) => void;
    backend.transcribe.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const dictation = new Dictation(events, "tr");
    await dictation.start();
    await vi.advanceTimersByTimeAsync(0);
    speak();
    pause();
    const stopped = dictation.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(backend.keepAlive).toHaveBeenCalledWith("dictation");
    finish({ text: "tamam", language: "tr", inferenceMs: 1 });
    await stopped;
    expect(vi.getTimerCount()).toBe(0);
    backend.keepAlive.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(backend.keepAlive).not.toHaveBeenCalled();
    expect(backend.release).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("reports a dropped lease instead of stopping silently, releasing once", async () => {
  vi.useFakeTimers();
  try {
    const events = setup();
    const dictation = new Dictation(events, "tr");
    await dictation.start();
    await vi.advanceTimersByTimeAsync(0);
    backend.keepAlive.mockRejectedValueOnce(new Error("Voice lease expired."));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(events.error).toHaveBeenCalledExactlyOnceWith("Voice lease expired.");
    expect(events.state).toHaveBeenLastCalledWith("idle");
    expect(track.stop).toHaveBeenCalled();
    expect(backend.release).toHaveBeenCalledExactlyOnceWith("dictation");
    expect(vi.getTimerCount()).toBe(0);
    dictation.cancel();
    expect(backend.release).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("previews the phrase in progress and replaces it with the final text at the pause", async () => {
  const events = setup();
  let finishPreview!: (value: unknown) => void;
  backend.transcribe
    .mockResolvedValueOnce({ text: " Merhaba ", language: "tr", inferenceMs: 40 })
    .mockImplementationOnce(() => new Promise((resolve) => (finishPreview = resolve)))
    .mockResolvedValueOnce({ text: "Merhaba dünya", language: "tr", inferenceMs: 60 });
  const dictation = new Dictation(events, "tr");
  await dictation.start();
  await vi.waitFor(() => expect(events.state).toHaveBeenLastCalledWith("listening"));
  // About one second of continuous speech without a pause.
  speak(15);
  await vi.waitFor(() => expect(events.text).toHaveBeenCalledWith("Merhaba", false));
  speak(15);
  await vi.waitFor(() => expect(backend.transcribe).toHaveBeenCalledTimes(2));
  pause();
  await vi.waitFor(() => expect(events.text).toHaveBeenLastCalledWith("Merhaba dünya", true));
  // A preview that returns after its phrase ended never overwrites the final text.
  finishPreview({ text: "Merhaba dü", language: "tr", inferenceMs: 40 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(events.text.mock.calls).toEqual([
    ["Merhaba", false],
    ["Merhaba dünya", true],
  ]);
  dictation.cancel();
});

it("uses cloud recognition without a local recognizer and reports provider errors", async () => {
  const events = setup();
  backend.cloudTranscribe
    .mockResolvedValueOnce({ text: "bulut cümlesi" })
    .mockRejectedValueOnce(new Error("OpenAI is not signed in."));
  const dictation = new Dictation(
    events,
    "tr",
    { natural: true },
    undefined,
    "openai",
    "gpt-4o-transcribe",
  );
  await dictation.start();
  await vi.waitFor(() => expect(events.state).toHaveBeenLastCalledWith("listening"));
  expect(backend.start).not.toHaveBeenCalled();
  speak();
  pause();
  await vi.waitFor(() => expect(events.text).toHaveBeenCalledWith("bulut cümlesi", true));
  expect(backend.cloudTranscribe).toHaveBeenCalledWith(
    "openai",
    expect.any(String),
    "tr",
    "gpt-4o-transcribe",
  );
  speak();
  pause();
  await vi.waitFor(() => expect(events.error).toHaveBeenCalledWith("OpenAI is not signed in."));
  await dictation.stop();
  expect(backend.release).not.toHaveBeenCalled();
  expect(backend.transcribe).not.toHaveBeenCalled();
});
it("retains quiet recording when silence filtering is disabled", async () => {
  const events = setup();
  backend.transcribe.mockResolvedValueOnce({
    text: "quiet speech",
    language: "en",
    inferenceMs: 80,
  });
  const dictation = new Dictation(events, "en", undefined, undefined, "local", undefined, {
    silenceFilter: false,
  });
  await dictation.start();
  pause();
  await dictation.stop();
  expect(events.text).toHaveBeenCalledWith("quiet speech", true);
});

it("keeps recognized speech when optional cleanup fails", async () => {
  const events = setup();
  backend.transcribe.mockResolvedValueOnce({
    text: "original words",
    language: "en",
    inferenceMs: 1,
  });
  backend.processDictation.mockRejectedValueOnce(new Error("provider unavailable"));
  const dictation = new Dictation(events, "en", undefined, undefined, "local", undefined, {
    cleanup: {
      enabled: true,
      model: "",
      instructions: "",
      correctionCue: "",
      translateToEnglish: false,
    },
  });
  await dictation.start();
  speak();
  await dictation.stop();
  expect(events.text).toHaveBeenCalledWith("original words", true);
  expect(events.error).toHaveBeenCalled();
});

it("discards a cleanup result arriving after cancellation", async () => {
  const events = setup();
  let complete!: (value: { text: string }) => void;
  backend.transcribe.mockResolvedValueOnce({ text: "original", language: "en", inferenceMs: 1 });
  backend.processDictation.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const dictation = new Dictation(events, "en", undefined, undefined, "local", undefined, {
    cleanup: {
      enabled: true,
      model: "",
      instructions: "",
      correctionCue: "",
      translateToEnglish: false,
    },
  });
  await dictation.start();
  speak();
  const stopping = dictation.stop();
  await vi.waitFor(() => expect(backend.processDictation).toHaveBeenCalled());
  const runId = backend.processDictation.mock.calls[0][0].runId;
  dictation.cancel();
  expect(backend.cancelDictationCleanup).toHaveBeenCalledWith(runId);
  complete({ text: "late" });
  await stopping;
  expect(events.text).not.toHaveBeenCalledWith("late", true);
});
it("does not dispatch queued cloud audio after cancellation", async () => {
  const events = setup();
  const complete: Array<(value: { text: string }) => void> = [];
  backend.cloudTranscribe.mockImplementation(
    () => new Promise((resolve) => complete.push(resolve)),
  );
  const dictation = new Dictation(events, "en", undefined, undefined, "openai");
  await dictation.start();
  speak();
  pause();
  speak();
  pause();
  speak();
  pause();
  await vi.waitFor(() => expect(backend.cloudTranscribe).toHaveBeenCalledTimes(2));
  dictation.cancel();
  complete.forEach((resolve) => resolve({ text: "old" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(backend.cloudTranscribe).toHaveBeenCalledTimes(2);
  expect(events.text).not.toHaveBeenCalled();
});
