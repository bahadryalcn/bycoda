// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
const backend = vi.hoisted(() => ({
  start: vi.fn(async () => ({ lease: "local", model: "small", device: "cuda" })),
  release: vi.fn(async () => {}),
  transcribe: vi.fn(async () => ({ text: "Ne durumdasın?", language: "tr", inferenceMs: 150 })),
  keepAlive: vi.fn(async () => ({ ready: true })),
  endpoint: vi.fn(async (): Promise<any> => ({ complete: false })),
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
  vi.useRealTimers();
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
    playback: vi.fn(),
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
it("captures and transcribes PCM locally with the app language as a hint, and mutes actual input", async () => {
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
  expect(backend.transcribe).toHaveBeenCalledWith("local", expect.any(String), "en");
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
  const voice = new LocalVoice(callbacks(), "tr", { natural: true, engine: "voxcpm2" });
  await voice.connect();
  expect(voice.speak("Merhaba")).toBe(true);
  await vi.waitFor(() => expect(playback).toHaveLength(1));
  expect(playback[0].start).toHaveBeenCalledWith(0.35);
  expect(speechSynthesis.speak).not.toHaveBeenCalled();
  voice.silence();
  expect(playback[0].stop).toHaveBeenCalledOnce();
  voice.close();
});
it("queues appended natural sentences back to back and drops the queue on silence", async () => {
  setup();
  const chunk = { audio: btoa("\0\0".repeat(4800)), sampleRate: 48000 };
  backend.speak.mockResolvedValueOnce({ id: "one" }).mockResolvedValueOnce({ id: "two" });
  backend.speechNext
    .mockResolvedValueOnce(chunk)
    .mockResolvedValueOnce({ done: true })
    .mockResolvedValueOnce(chunk)
    .mockResolvedValueOnce({ done: true });
  const voice = new LocalVoice(callbacks(), "tr", { natural: true, engine: "voxcpm2" });
  await voice.connect();
  expect(voice.speak("Birinci cümle.")).toBe(true);
  expect(voice.speak("İkinci cümle.", true)).toBe(true);
  // The Host synthesizes one text at a time: the second waits for the first stream.
  expect(backend.speak).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(playback).toHaveLength(2));
  expect(backend.speak.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
    "Birinci cümle.",
    "İkinci cümle.",
  ]);
  // 0.1 s chunks at 48 kHz; the second sentence starts where the first ends.
  expect(playback[0].start).toHaveBeenCalledWith(0.35);
  expect(playback[1].start.mock.calls[0][0]).toBeCloseTo(0.45);

  voice.speak("Üçüncü.", true);
  voice.silence();
  await Promise.resolve();
  await Promise.resolve();
  expect(backend.speak).toHaveBeenCalledTimes(2);
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

it("smooths normalized microphone RMS without state callbacks and resets on mute and close", async () => {
  setup();
  const events = callbacks();
  const level = { current: 0 };
  const voice = new LocalVoice(events, "en", undefined, level);
  await voice.connect();
  events.state.mockClear();
  expect(voice.level).toBe(level);
  nodes[0].port.onmessage({ data: new Int16Array(1024).fill(16384).buffer });
  expect(voice.level).toBe(level);
  expect(level.current).toBeCloseTo(0.275);
  expect(events.state.mock.calls).toEqual([["speaking"]]);
  events.state.mockClear();
  nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
  expect(level.current).toBeCloseTo(0.22);
  expect(events.state).not.toHaveBeenCalled();
  voice.mute(true);
  expect(level.current).toBe(0);
  nodes[0].port.onmessage({ data: new Int16Array(1024).fill(-32768).buffer });
  expect(level.current).toBe(0);
  voice.mute(false);
  nodes[0].port.onmessage({ data: new Int16Array(1024).fill(-32768).buffer });
  expect(level.current).toBeGreaterThan(0);
  expect(level.current).toBeLessThanOrEqual(1);
  voice.close();
  expect(level.current).toBe(0);
});

async function settleSpeech() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}

it("reports natural playback only after its audio clock starts and until the final chunk ends", async () => {
  setup();
  vi.useFakeTimers();
  const chunk = { audio: btoa("\0\0".repeat(7680)), sampleRate: 48000 };
  backend.speechNext.mockResolvedValueOnce(chunk).mockResolvedValueOnce(chunk);
  const events = callbacks();
  const voice = new LocalVoice(events, "en", { natural: true, engine: "voxcpm2" });
  await voice.connect();
  voice.speak("Hello");
  await settleSpeech();
  expect(playback).toHaveLength(2);
  // Playback has its own device-rate context, separate from 16 kHz capture.
  expect(contexts).toHaveLength(2);
  expect(backend.speak).toHaveBeenCalledWith("local", "Hello", "en");
  expect(events.playback).not.toHaveBeenCalled();
  // A suspended audio clock does not imply audible playback, even after wall time passes.
  contexts[1].state = "suspended";
  await vi.advanceTimersByTimeAsync(350);
  expect(events.playback).not.toHaveBeenCalled();
  contexts[1].state = "running";
  contexts[1].currentTime = 0.35;
  await vi.advanceTimersByTimeAsync(350);
  expect(events.playback.mock.calls).toEqual([[true]]);
  playback[0].onended();
  expect(events.playback.mock.calls).toEqual([[true]]);
  playback[1].onended();
  expect(events.playback.mock.calls).toEqual([[true], [false]]);
  voice.close();
  expect(contexts[1].close).toHaveBeenCalled();
});

it("cancels pending natural onset and ignores ended events from replaced speech", async () => {
  setup();
  vi.useFakeTimers();
  const chunk = { audio: btoa("\0\0".repeat(7680)), sampleRate: 48000 };
  backend.speechNext.mockResolvedValueOnce(chunk);
  const events = callbacks();
  const voice = new LocalVoice(events, "en", { natural: true, engine: "voxcpm2" });
  await voice.connect();
  voice.speak("First");
  await settleSpeech();
  voice.silence();
  contexts[1].currentTime = 1;
  await vi.advanceTimersByTimeAsync(1000);
  expect(events.playback).not.toHaveBeenCalled();
  backend.speechNext.mockResolvedValueOnce(chunk);
  voice.speak("Second");
  await settleSpeech();
  contexts[1].currentTime = 1.35;
  await vi.advanceTimersByTimeAsync(350);
  expect(events.playback.mock.calls).toEqual([[true]]);
  playback[0].onended();
  expect(events.playback.mock.calls).toEqual([[true]]);
  voice.silence();
  expect(events.playback.mock.calls).toEqual([[true], [false]]);
  voice.close();
});

it("uses system utterance lifecycle and rejects stale events after silence or replacement", () => {
  setup();
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(public text: string) {}
    },
  );
  speechSynthesis.getVoices = () =>
    [{ localService: true, lang: "en-US" }] as SpeechSynthesisVoice[];
  const events = callbacks();
  const voice = new LocalVoice(events, "en");
  voice.speak("First");
  const first = vi.mocked(speechSynthesis.speak).mock.calls[0][0];
  expect(events.playback).not.toHaveBeenCalled();
  first.onstart!({} as SpeechSynthesisEvent);
  expect(events.playback.mock.calls).toEqual([[true]]);
  voice.speak("Second");
  const second = vi.mocked(speechSynthesis.speak).mock.calls[1][0];
  second.onstart!({} as SpeechSynthesisEvent);
  first.onend!({} as SpeechSynthesisEvent);
  expect(events.playback.mock.calls).toEqual([[true], [false], [true]]);
  second.onerror!({} as SpeechSynthesisErrorEvent);
  expect(events.playback.mock.calls).toEqual([[true], [false], [true], [false]]);
  voice.speak("Third");
  const third = vi.mocked(speechSynthesis.speak).mock.calls[2][0];
  voice.close();
  third.onstart!({} as SpeechSynthesisEvent);
  expect(events.playback.mock.calls).toEqual([[true], [false], [true], [false]]);
});

it("ends a finished sentence at the short pause with Smart Turn and keeps listening otherwise", async () => {
  setup();
  backend.start.mockResolvedValueOnce({
    lease: "local",
    model: "turbo",
    device: "cuda",
    turn: true,
  } as any);
  const events = callbacks();
  const voice = new LocalVoice(events, "tr");
  await voice.connect();
  const speech = () => nodes[0].port.onmessage({ data: new Int16Array(1024).fill(4000).buffer });
  const quiet = () => nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
  // A mid-sentence pause: the model says "not finished", so nothing is transcribed.
  for (let i = 0; i < 5; i++) speech();
  for (let i = 0; i < 4; i++) quiet();
  await vi.waitFor(() => expect(backend.endpoint).toHaveBeenCalledOnce());
  expect(backend.endpoint).toHaveBeenCalledWith("local", expect.any(String), "tr");
  expect(events.transcript).not.toHaveBeenCalled();
  // The sentence ends: its text arrives with the pause check, after ~0.25 s of silence.
  backend.endpoint.mockResolvedValueOnce({
    text: "Testleri çalıştır.",
    language: "tr",
    inferenceMs: 400,
    complete: true,
  });
  for (let i = 0; i < 3; i++) speech();
  for (let i = 0; i < 4; i++) quiet();
  await vi.waitFor(() => expect(events.transcript).toHaveBeenCalledOnce());
  expect(events.transcript.mock.calls[0][0]).toMatchObject({ text: "Testleri çalıştır." });
  // The committed turn is not transcribed again by the fallback silence.
  for (let i = 0; i < 30; i++) quiet();
  await Promise.resolve();
  expect(backend.transcribe).not.toHaveBeenCalled();
  voice.close();
});

it("starts complete Supertonic sentences almost at once and plays its 44.1 kHz audio as is", async () => {
  setup();
  backend.speechNext.mockResolvedValueOnce({ audio: btoa("\0\0".repeat(4410)), sampleRate: 44100 });
  const voice = new LocalVoice(callbacks(), "tr", { natural: true });
  await voice.connect();
  expect(voice.speak("Merhaba")).toBe(true);
  await vi.waitFor(() => expect(playback).toHaveLength(1));
  expect(playback[0].start).toHaveBeenCalledWith(0.05);
  expect(contexts[1].createBuffer).toHaveBeenCalledWith(1, 4410, 44100);
  voice.close();
});
