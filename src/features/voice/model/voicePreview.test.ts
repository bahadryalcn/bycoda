// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SPEAKERS } from "./voiceSpeakers";
import type { VoiceSettings } from "./voiceSettings";
const mock = vi.hoisted(() => ({
  callbacks: null as any,
  connect: vi.fn(async () => {}),
  close: vi.fn(),
  speak: vi.fn(),
  secret: vi.fn(async () => ({})),
  start: vi.fn(async () => ({ lease: "preview" })),
  release: vi.fn(async () => {}),
  speech: vi.fn(async () => ({ id: "speech" })),
  next: vi.fn(),
  cancel: vi.fn(async () => {}),
}));
vi.mock("./realtimeVoice", () => ({
  RealtimeVoice: class {
    constructor(...args: any[]) {
      mock.callbacks = args[1];
    }
    connect = mock.connect;
    close = mock.close;
    speak = mock.speak;
  },
}));
vi.mock("./realtimeVoiceClient", () => ({ realtimeSecret: mock.secret }));
vi.mock("./localVoiceClient", () => ({
  localVoiceBackend: {
    start: mock.start,
    release: mock.release,
    speak: mock.speech,
    speechNext: mock.next,
    speechCancel: mock.cancel,
  },
}));
import { previewVoice } from "./voicePreview";
const settings = { mode: "openai", speakers: DEFAULT_SPEAKERS, natural: true } as VoiceSettings;
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("waits for response completion and actual speaker end, with no microphone or tool grant", async () => {
  const abort = new AbortController(),
    played = vi.fn();
  let completed = false;
  const result = previewVoice(
    settings,
    "tr-TR",
    "Arif",
    abort.signal,
    played,
    "Briefing",
    undefined,
    { complete: true },
  ).then(() => {
    completed = true;
  });
  await vi.waitFor(() => expect(mock.speak).toHaveBeenCalled());
  expect(mock.connect.mock.calls[0][2]).toEqual({ microphone: false });
  mock.callbacks.playback(true);
  await Promise.resolve();
  expect(completed).toBe(false);
  mock.callbacks.replyDone();
  await Promise.resolve();
  expect(completed).toBe(false);
  mock.callbacks.playback(false);
  await result;
  expect(played).toHaveBeenCalledOnce();
  expect(mock.close).toHaveBeenCalled();
  expect(await mock.callbacks.tool("anything", { approved: true })).toEqual({
    error: "Tools are disabled during voice preview.",
  });
});
it("refuses unknown Auto briefing language rather than silently choosing English", async () => {
  await expect(
    previewVoice(
      settings,
      "auto",
      "Arif",
      new AbortController().signal,
      vi.fn(),
      "Actual briefing",
      undefined,
      { complete: true },
    ),
  ).rejects.toThrow("Speak once or choose a language");
  expect(mock.secret).not.toHaveBeenCalled();
});
it("accepts exact 6000-character briefing content and rejects silent truncation", async () => {
  const abort = new AbortController();
  const result = previewVoice(
    settings,
    "auto",
    "Arif",
    abort.signal,
    vi.fn(),
    "x".repeat(6000),
    undefined,
    { complete: true, languageHint: "tr-TR" },
  );
  await vi.waitFor(() => expect(mock.speak).toHaveBeenCalled());
  expect(mock.speak.mock.calls[0][0]).toContain("x".repeat(6000));
  abort.abort();
  await result;
  await expect(
    previewVoice(
      settings,
      "tr-TR",
      "Arif",
      new AbortController().signal,
      vi.fn(),
      "x".repeat(6001),
      undefined,
      { complete: true },
    ),
  ).rejects.toThrow("too long");
});
it("system-voice completion waits for onend and cancellation cleans up without microphone capture", async () => {
  let utterance: any;
  const cancel = vi.fn();
  vi.stubGlobal("speechSynthesis", {
    cancel,
    getVoices: () => [{ localService: true, lang: "tr-TR" }],
    speak: (value: any) => {
      utterance = value;
    },
  });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(public text: string) {}
    },
  );
  let done = false;
  const result = previewVoice(
    { ...settings, mode: "local", natural: false },
    "tr-TR",
    "Arif",
    new AbortController().signal,
    vi.fn(),
    "Günaydın",
    undefined,
    { complete: true },
  ).then(() => {
    done = true;
  });
  utterance.onstart();
  await Promise.resolve();
  expect(done).toBe(false);
  utterance.onend();
  await result;
  expect(done).toBe(true);
  expect(cancel).not.toHaveBeenCalled();
});
it("natural completion waits for queued playback to end and releases its existing Host lease", async () => {
  let source: any;
  const close = vi.fn(async () => {});
  vi.stubGlobal(
    "AudioContext",
    class {
      currentTime = 0;
      destination = {};
      resume = async () => {};
      close = close;
      createBuffer = (_channels: number, length: number, _rate: number) => ({
        duration: 1,
        getChannelData: () => new Float32Array(length),
      });
      createBufferSource = () =>
        (source = {
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          onended: null,
          buffer: null,
        });
    },
  );
  mock.next.mockResolvedValueOnce({ audio: btoa("\0\0\0\0"), sampleRate: 24000, done: true });
  const config = {
    ...settings,
    mode: "local",
    engine: "supertonic",
    device: "auto",
    python: "",
    whisperPath: "",
    ttsPath: "",
    elevenVoice: "",
  } as VoiceSettings;
  let done = false;
  const result = previewVoice(
    config,
    "tr-TR",
    "Arif",
    new AbortController().signal,
    vi.fn(),
    "Günaydın",
    undefined,
    { complete: true },
  ).then(() => {
    done = true;
  });
  await vi.waitFor(() => expect(source?.start).toHaveBeenCalled());
  expect(done).toBe(false);
  source.onended();
  await result;
  expect(done).toBe(true);
  expect(mock.release).toHaveBeenCalledWith("preview");
  expect(close).toHaveBeenCalled();
});
