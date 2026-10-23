// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({
  start: vi.fn(async () => ({ lease: "local", model: "small", device: "cuda" })),
  release: vi.fn(async () => {}),
  transcribe: vi.fn(async () => ({ text: "Ne durumdasın?", language: "tr", inferenceMs: 150 })),
  keepAlive: vi.fn(async () => ({ ready: true })),
  speak: vi.fn(async () => ({ id: "speech" })),
  speechNext: vi.fn(async (): Promise<any> => ({ done: true })),
  speechCancel: vi.fn(async () => ({})),
}));
vi.mock("./localVoiceClient", () => ({ localVoiceBackend: backend }));
import { LocalVoice } from "./localVoice";
const track = { stop: vi.fn(), enabled: true };
const nodes: any[] = [];
const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), port: { onmessage: null as any } });
const contexts: any[] = [];
const playback: any[] = [];
function setup() {
  vi.stubGlobal(
    "AudioContext",
    class {
      sampleRate = 16000;
      state = "running";
      destination = {};
      currentTime = 0;
      createBuffer = vi.fn((_channels: number, length: number, sampleRate: number) => ({
        duration: length / sampleRate,
        getChannelData: () => new Float32Array(length),
      }));
      createBufferSource = vi.fn(() => {
        const source = {
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
          buffer: null,
          onended: null,
        };
        playback.push(source);
        return source;
      });
      audioWorklet = { addModule: vi.fn(async () => {}) };
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {
        this.state = "closed";
      });
      createMediaStreamSource = vi.fn(node);
      constructor() {
        contexts.push(this);
      }
    },
  );
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      constructor() {
        const value = node();
        nodes.push(value);
        return value;
      }
    },
  );
  const getUserMedia = vi.fn(async () => ({
    getTracks: () => [track],
    getAudioTracks: () => [track],
  }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  vi.stubGlobal("speechSynthesis", {
    cancel: vi.fn(),
    speak: vi.fn(),
    getVoices: () => [{ localService: false, lang: "tr-TR" }],
  });
  return getUserMedia;
}
afterEach(() => {
  nodes.length = 0;
  contexts.length = 0;
  playback.length = 0;
  track.enabled = true;
  track.stop.mockClear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function callbacks() {
  return {
    start: vi.fn(() => ({ sessionId: "a", sequence: 1 })),
    transcript: vi.fn(),
    state: vi.fn(),
    error: vi.fn(),
  };
}
it("releases the local recognizer if closed during startup without opening a microphone", async () => {
  const getUserMedia = setup();
  let ready!: (value: any) => void;
  backend.start.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        ready = resolve;
      }),
  );
  const voice = new LocalVoice(callbacks(), "tr");
  const pending = voice.connect();
  voice.close();
  ready({ lease: "late", model: "small", device: "cuda" });
  await pending;
  expect(backend.release).toHaveBeenCalledWith("late");
  expect(getUserMedia).not.toHaveBeenCalled();
});
it("stops microphone tracks and releases resources, including a late microphone permission grant", async () => {
  const getUserMedia = setup();
  let grant!: (value: any) => void;
  getUserMedia.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  const voice = new LocalVoice(callbacks(), "tr");
  const pending = voice.connect();
  await Promise.resolve();
  voice.close();
  grant({ getTracks: () => [track], getAudioTracks: () => [track] });
  await pending;
  expect(track.stop).toHaveBeenCalled();
  expect(backend.release).toHaveBeenCalledWith("local");
});
it("captures and transcribes PCM locally with language detection, and mutes actual input", async () => {
  setup();
  const events = callbacks();
  const voice = new LocalVoice(events, "en");
  await voice.connect();
  for (let i = 0; i < 5; i++)
    nodes[0].port.onmessage({ data: new Int16Array(1024).fill(4000).buffer });
  for (let i = 0; i < 10; i++) nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
  await Promise.resolve();
  await Promise.resolve();
  expect(events.start).toHaveBeenCalledTimes(1);
  expect(backend.transcribe).toHaveBeenCalledWith("local", expect.any(String));
  expect(events.transcript).toHaveBeenCalledWith(expect.objectContaining({ language: "tr" }), {
    sessionId: "a",
    sequence: 1,
  });
  voice.mute(true);
  expect(track.enabled).toBe(false);
  voice.close();
  expect(contexts[0].close).toHaveBeenCalled();
});
it("never falls back to a network text-to-speech voice", () => {
  setup();
  const voice = new LocalVoice(callbacks(), "tr");
  expect(voice.speak("Merhaba")).toBe(false);
  expect(speechSynthesis.speak).not.toHaveBeenCalled();
  voice.close();
});
it("plays streamed local PCM and stops scheduled chunks on silence", async () => {
  setup();
  backend.speechNext.mockResolvedValueOnce({ audio: btoa("\0\0".repeat(7680)), sampleRate: 48000 });
  const voice = new LocalVoice(callbacks(), "tr", { natural: true });
  await voice.connect();
  expect(voice.speak("Merhaba")).toBe(true);
  await vi.waitFor(() => expect(playback).toHaveLength(1));
  expect(playback[0].start).toHaveBeenCalledWith(0.35);
  expect(speechSynthesis.speak).not.toHaveBeenCalled();
  voice.silence();
  expect(playback[0].stop).toHaveBeenCalledOnce();
  voice.close();
});
it("cancels a late synthesis acceptance without playing stale audio", async () => {
  setup();
  let accept!: (value: { id: string }) => void;
  backend.speak.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  );
  const voice = new LocalVoice(callbacks(), "tr", { natural: true });
  await voice.connect();
  voice.speak("Merhaba");
  voice.silence();
  accept({ id: "late" });
  await vi.waitFor(() => expect(backend.speechCancel).toHaveBeenCalledWith("local", "late"));
  expect(playback).toHaveLength(0);
  voice.close();
});
