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
/** A voiced (150 Hz) speech-like frame: the VAD requires pitch, not just level. */
const voicedFrame = () =>
  Int16Array.from({ length: 1024 }, (_, i) =>
    Math.round(4000 * Math.sin((2 * Math.PI * 150 * i) / 16000)),
  );
const track = { stop: vi.fn(), enabled: true };
const nodes: any[] = [];
const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), port: { onmessage: null as any } });
const contexts: any[] = [];
const playback: any[] = [];
function setup() {
  Reflect.set(track, "readyState", "live");
  track.stop.mockImplementation(() => { Reflect.set(track, "readyState", "ended"); });
  vi.stubGlobal(
    "AudioContext",
    class {
      sampleRate = 16000;
      state = "running";
      destination = {};
      createGain = vi.fn(() => ({ ...node(), gain: { value: 1 } }));
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
    speaking: false,
    pending: false,
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

it("retirement waits actual local backend lease release", async () => {
  setup();
  const voice = new LocalVoice(callbacks(), "tr");
  await voice.connect();
  const released = Promise.withResolvers<void>();
  backend.release.mockImplementationOnce(() => released.promise);
  Object.defineProperty(track, "readyState", { configurable: true, value: "live", writable: true });
  track.stop.mockImplementation(() => { Reflect.set(track, "readyState", "ended"); });
  let retired = false;
  const retirement = voice.retire().then(() => { retired = true; });
  try {
    await Promise.resolve();
    expect(retired).toBe(false);
    expect(backend.release).toHaveBeenCalledWith("local");
    released.resolve();
    await retirement;
    expect(retired).toBe(true);
  } finally {
    released.resolve(); await retirement;
    track.stop.mockReset(); Reflect.deleteProperty(track, "readyState");
  }
});

it("cannot certify retirement while native speech still reports pending output", async () => {
  vi.useFakeTimers();
  setup();
  const voice = new LocalVoice(callbacks(), "tr");
  await voice.connect();
  Reflect.set(globalThis.speechSynthesis, "speaking", true);
  let retired = false;
  const retirement = voice.retire().then(() => { retired = true; });
  try {
    await vi.advanceTimersByTimeAsync(40);
    expect(retired).toBe(false);
    Reflect.set(globalThis.speechSynthesis, "speaking", false);
    await vi.advanceTimersByTimeAsync(20);
    await retirement;
    expect(retired).toBe(true);
  } finally {
    Reflect.set(globalThis.speechSynthesis, "speaking", false);
    await vi.advanceTimersByTimeAsync(20);
    await retirement;
  }
});

it("push-to-talk commits on release and accepts delayed recognition with capture paused", async () => {
  const getUserMedia = setup(),
    events = callbacks(),
    voice = new LocalVoice(events, "tr");
  expect(voice.beginPushToTalk()).toBe(false);
  await voice.connect();
  voice.mute(true);
  let finish!: (value: any) => void;
  backend.transcribe.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  expect(voice.beginPushToTalk()).toBe(true);
  for (let i = 0; i < 6; i++) nodes[0].port.onmessage({ data: voicedFrame().buffer });
  for (let i = 0; i < 35; i++) nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
  expect(backend.transcribe).not.toHaveBeenCalled();
  voice.endPushToTalk();
  expect(backend.transcribe).toHaveBeenCalledOnce();
  expect(track.enabled).toBe(false);
  expect(voice.level.current).toBe(0);
  // A fresh key gesture without admitted words must not invalidate the first response.
  expect(voice.beginPushToTalk()).toBe(true);
  voice.endPushToTalk();
  finish({ text: "İşi göster", language: "tr", inferenceMs: 1 });
  await vi.waitFor(() => expect(events.transcript).toHaveBeenCalledOnce());
  expect(events.transcript.mock.calls[0][1]).toEqual({ sessionId: "a", sequence: 1 });
  expect(getUserMedia).toHaveBeenCalledOnce();
  voice.close();
  expect(voice.beginPushToTalk()).toBe(false);
});

it("explicit mute still cancels pending push-to-talk recognition", async () => {
  setup();
  const events = callbacks(),
    voice = new LocalVoice(events, "tr");
  await voice.connect();
  voice.mute(true);
  let finish!: (value: any) => void;
  backend.transcribe.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  voice.beginPushToTalk();
  for (let i = 0; i < 6; i++) nodes[0].port.onmessage({ data: voicedFrame().buffer });
  voice.endPushToTalk();
  voice.mute(true);
  finish({ text: "İşi başlat", language: "tr", inferenceMs: 1 });
  await settleSpeech();
  expect(events.transcript).not.toHaveBeenCalled();
  voice.close();
});
it("keeps Smart Turn and ASR idle in manual mode until explicit Finish turn", async () => {
  setup();
  backend.start.mockResolvedValueOnce({
    lease: "local",
    model: "small",
    device: "cuda",
    turn: true,
  } as any);
  const events = callbacks(),
    voice = new LocalVoice(events, "tr", undefined, undefined, { manualTurnEnd: true });
  await voice.connect();
  const push = (frame: Int16Array) => nodes[0].port.onmessage({ data: frame.buffer });
  for (let n = 0; n < 6; n++) push(voicedFrame());
  for (let n = 0; n < 1000; n++) push(new Int16Array(1024));
  expect(backend.endpoint).not.toHaveBeenCalled();
  expect(backend.transcribe).not.toHaveBeenCalled();
  voice.finishTurn();
  await vi.waitFor(() => expect(events.transcript).toHaveBeenCalledOnce());
  voice.close();
});

it.each(["", "[cough]", "(boğaz temizleme)"])(
  "keeps playback and the pending reply intact for rejected recognition %j",
  async (text) => {
    setup();
    const events = { ...callbacks(), accept: vi.fn((binding) => binding) };
    backend.transcribe.mockResolvedValueOnce({ text, language: "tr", inferenceMs: 1 });
    const voice = new LocalVoice(events, "tr");
    await voice.connect();
    const cancel = vi.mocked(speechSynthesis.cancel);
    cancel.mockClear();
    for (let i = 0; i < 5; i++) nodes[0].port.onmessage({ data: voicedFrame().buffer });
    expect(events.start).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    for (let i = 0; i < 20; i++) nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
    await Promise.resolve();
    await Promise.resolve();
    expect(events.accept).not.toHaveBeenCalled();
    expect(events.transcript).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    voice.close();
  },
);

it.each(["", "[cough]", "(boğaz temizleme)"])(
  "retains pending real speech across a later rejected candidate %j",
  async (noise) => {
    setup();
    let finish!: (result: any) => void;
    let rejectNoise!: (result: any) => void;
    backend.transcribe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    backend.transcribe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          rejectNoise = resolve;
        }),
    );
    const events = { ...callbacks(), accept: vi.fn((binding) => ({ ...binding, sequence: 2 })) };
    const voice = new LocalVoice(events, "tr");
    await voice.connect();
    const speech = () => {
      for (let i = 0; i < 5; i++) nodes[0].port.onmessage({ data: voicedFrame().buffer });
    };
    const end = () => {
      for (let i = 0; i < 20; i++) nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
    };
    speech();
    end();
    speech(); // A second acoustic onset must not invalidate the first ASR.
    vi.mocked(speechSynthesis.cancel).mockClear();
    finish({ text: "evet", language: "tr", inferenceMs: 1 });
    await vi.waitFor(() => expect(events.transcript).toHaveBeenCalledOnce());
    end();
    rejectNoise({ text: noise, language: "tr", inferenceMs: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(events.transcript).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ text: "evet" }),
      { sessionId: "a", sequence: 2 },
    );
    expect(events.accept).toHaveBeenCalledOnce();
    expect(speechSynthesis.cancel).toHaveBeenCalledOnce();
    voice.close();
  },
);

it.each(["older-first", "newer-first", "cancelled"])(
  "orders overlapping real recognitions without bypassing cancellation: %s",
  async (order) => {
    setup();
    const finish: ((result: any) => void)[] = [];
    for (let i = 0; i < 2; i++)
      backend.transcribe.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish.push(resolve);
          }),
      );
    let sequence = 1;
    const events = {
      ...callbacks(),
      start: vi.fn(() => ({ sessionId: "a", sequence })),
      accept: vi.fn((binding) =>
        binding.sequence === sequence ? { ...binding, sequence: ++sequence } : undefined,
      ),
    };
    const voice = new LocalVoice(events, "tr");
    await voice.connect();
    for (let turn = 0; turn < 2; turn++) {
      for (let i = 0; i < 5; i++) nodes[0].port.onmessage({ data: voicedFrame().buffer });
      for (let i = 0; i < 20; i++) nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
    }
    const resolve = async (index: number) => {
      finish[index]({ text: index ? "hayır" : "evet", language: "tr", inferenceMs: 1 });
      await Promise.resolve();
      await Promise.resolve();
    };
    if (order === "cancelled") sequence++; // An external close/retarget is not our promotion.
    await resolve(order === "newer-first" ? 1 : 0);
    await resolve(order === "newer-first" ? 0 : 1);
    const words = events.transcript.mock.calls.map(([result]) => result.text);
    expect(words).toEqual(
      order === "cancelled" ? [] : order === "newer-first" ? ["hayır"] : ["evet", "hayır"],
    );
    voice.close();
  },
);

it("invalidates pending recognition across mute and resume", async () => {
  setup();
  let finish!: (result: any) => void;
  backend.transcribe.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const events = { ...callbacks(), accept: vi.fn((binding) => binding) };
  const voice = new LocalVoice(events, "tr");
  await voice.connect();
  for (let i = 0; i < 5; i++) nodes[0].port.onmessage({ data: voicedFrame().buffer });
  for (let i = 0; i < 20; i++) nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
  voice.mute(true);
  voice.mute(false);
  finish({ text: "stop", language: "en", inferenceMs: 1 });
  await Promise.resolve();
  await Promise.resolve();
  expect(events.accept).not.toHaveBeenCalled();
  expect(events.transcript).not.toHaveBeenCalled();
  voice.close();
});

it("interrupts only after accepted words and retains the onset target", async () => {
  setup();
  const events = { ...callbacks(), accept: vi.fn((binding) => ({ ...binding, sequence: 2 })) };
  const voice = new LocalVoice(events, "tr");
  await voice.connect();
  vi.mocked(speechSynthesis.cancel).mockClear();
  for (let i = 0; i < 5; i++) nodes[0].port.onmessage({ data: voicedFrame().buffer });
  expect(speechSynthesis.cancel).not.toHaveBeenCalled();
  for (let i = 0; i < 20; i++) nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
  await Promise.resolve();
  await Promise.resolve();
  expect(events.accept).toHaveBeenCalledWith({ sessionId: "a", sequence: 1 });
  expect(speechSynthesis.cancel).toHaveBeenCalledOnce();
  expect(events.transcript).toHaveBeenCalledWith(expect.anything(), {
    sessionId: "a",
    sequence: 2,
  });
  voice.close();
});

it.each(["evet", "hayır", "dur", "yes", "no", "stop"])(
  "admits recognized short speech %j without a word-count or length gate",
  async (text) => {
    setup();
    backend.transcribe.mockResolvedValueOnce({ text, language: "tr", inferenceMs: 1 });
    const events = callbacks();
    const voice = new LocalVoice(events, "tr");
    await voice.connect();
    for (let i = 0; i < 2; i++) nodes[0].port.onmessage({ data: voicedFrame().buffer });
    for (let i = 0; i < 20; i++) nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
    await Promise.resolve();
    await Promise.resolve();
    expect(events.transcript).toHaveBeenCalledWith(
      expect.objectContaining({ text }),
      expect.anything(),
    );
    voice.close();
  },
);

it("keeps playback on an empty endpoint result and drops speech accepted after mute", async () => {
  setup();
  backend.start.mockResolvedValueOnce({
    lease: "local",
    model: "small",
    device: "cuda",
    turn: true,
  } as any);
  backend.endpoint.mockResolvedValueOnce({ text: "", language: "tr", inferenceMs: 1 });
  const events = { ...callbacks(), accept: vi.fn((binding) => binding) };
  const voice = new LocalVoice(events, "tr");
  await voice.connect();
  vi.mocked(speechSynthesis.cancel).mockClear();
  for (let i = 0; i < 5; i++) nodes[0].port.onmessage({ data: voicedFrame().buffer });
  for (let i = 0; i < 4; i++) nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
  await Promise.resolve();
  await Promise.resolve();
  expect(events.accept).not.toHaveBeenCalled();
  expect(speechSynthesis.cancel).not.toHaveBeenCalled();
  let finish!: (result: any) => void;
  backend.endpoint.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  for (let i = 0; i < 5; i++) nodes[0].port.onmessage({ data: voicedFrame().buffer });
  for (let i = 0; i < 4; i++) nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
  voice.mute(true);
  finish({ text: "stop the work", language: "en", inferenceMs: 1 });
  await Promise.resolve();
  await Promise.resolve();
  expect(events.transcript).not.toHaveBeenCalled();
  expect(events.accept).not.toHaveBeenCalled();
  voice.close();
});
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
  for (let i = 0; i < 5; i++) nodes[0].port.onmessage({ data: voicedFrame().buffer });
  for (let i = 0; i < 20; i++) nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
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
  // One loud frame without pitch (a click or breath) is not speech.
  expect(events.state).not.toHaveBeenCalled();
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

it("mutes natural playback gain without cancelling speech or disabling input", async () => {
  setup();
  backend.speechNext.mockResolvedValueOnce({ audio: btoa("\0\0".repeat(1600)), sampleRate: 16000 });
  const events = callbacks(),
    voice = new LocalVoice(events, "en", { natural: true });
  voice.setOutputMuted(true);
  await voice.connect();
  voice.speak("Hello");
  await settleSpeech();
  const gain = contexts[1].createGain.mock.results[0].value;
  expect(gain.gain.value).toBe(0);
  expect(playback[0].connect).toHaveBeenCalledWith(gain);
  voice.setOutputMuted(false);
  expect(gain.gain.value).toBe(1);
  expect(playback[0].stop).not.toHaveBeenCalled();
  expect(track.enabled).toBe(true);
  voice.close();
});

it("ends a suspended output wait instead of polling forever", async () => {
  setup();
  vi.useFakeTimers();
  backend.speechNext.mockResolvedValueOnce({ audio: btoa("\0\0".repeat(1600)), sampleRate: 16000 });
  const events = callbacks(),
    voice = new LocalVoice(events, "en", { natural: true });
  await voice.connect();
  voice.speak("Hello");
  await settleSpeech();
  contexts[1].state = "suspended";
  await vi.advanceTimersByTimeAsync(5_200);
  expect(events.error).toHaveBeenCalledWith("Voice playback is suspended. Start voice again.");
  expect(playback[0].stop).toHaveBeenCalledOnce();
  expect(events.playback).not.toHaveBeenCalledWith(true);
  voice.close();
});

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
  const speech = () => nodes[0].port.onmessage({ data: voicedFrame().buffer });
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
it("consumes recognized backchannels without interrupting playback or accepting a new turn", async () => {
  setup();
  const events = {
    ...callbacks(),
    accept: vi.fn((binding) => binding),
    interceptTranscript: vi.fn(() => true),
  };
  backend.transcribe.mockResolvedValueOnce({ text: "hı hı", language: "tr", inferenceMs: 1 });
  const voice = new LocalVoice(events, "tr");
  await voice.connect();
  vi.mocked(speechSynthesis.cancel).mockClear();
  for (let i = 0; i < 5; i++) nodes[0].port.onmessage({ data: voicedFrame().buffer });
  for (let i = 0; i < 20; i++) nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
  await vi.waitFor(() => expect(events.interceptTranscript).toHaveBeenCalledOnce());
  expect(events.accept).not.toHaveBeenCalled();
  expect(events.transcript).not.toHaveBeenCalled();
  expect(speechSynthesis.cancel).not.toHaveBeenCalled();
  voice.close();
});
it("does not admit older recognition after a newer acknowledged backchannel", async () => {
  setup();
  const finish: ((result: any) => void)[] = [];
  for (let i = 0; i < 2; i++)
    backend.transcribe.mockImplementationOnce(() => new Promise((resolve) => finish.push(resolve)));
  const events = {
    ...callbacks(),
    accept: vi.fn((binding) => binding),
    interceptTranscript: vi.fn((result) => result.text === "tamam"),
  };
  const voice = new LocalVoice(events, "tr");
  await voice.connect();
  try {
    for (let turn = 0; turn < 2; turn++) {
      for (let i = 0; i < 5; i++) nodes[0].port.onmessage({ data: voicedFrame().buffer });
      for (let i = 0; i < 20; i++) nodes[0].port.onmessage({ data: new Int16Array(1024).buffer });
    }
    finish[1]({ text: "tamam", language: "tr", inferenceMs: 1 });
    await vi.waitFor(() => expect(events.interceptTranscript).toHaveBeenCalledOnce());
    finish[0]({ text: "eski isteği başlat", language: "tr", inferenceMs: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(events.accept).not.toHaveBeenCalled();
    expect(events.transcript).not.toHaveBeenCalled();
  } finally {
    voice.close();
  }
});

it("marks natural speech delivered only after its audio ends, never after cancellation", async () => {
  setup();
  const chunk = { audio: btoa("\0\0".repeat(4800)), sampleRate: 48000 };
  backend.speechNext.mockResolvedValueOnce(chunk).mockResolvedValueOnce({ done: true });
  const voice = new LocalVoice(callbacks(), "tr", { natural: true, engine: "voxcpm2" });
  await voice.connect();
  const delivered = vi.fn();
  voice.speak("Merhaba", false, delivered);
  await vi.waitFor(() => expect(playback).toHaveLength(1));
  await vi.waitFor(() => expect(backend.speechNext).toHaveBeenCalledTimes(2));
  expect(delivered).not.toHaveBeenCalled();
  playback[0].onended();
  await vi.waitFor(() => expect(delivered).toHaveBeenCalledOnce());
  backend.speechNext.mockResolvedValueOnce(chunk).mockResolvedValueOnce({ done: true });
  const cancelled = vi.fn();
  voice.speak("Tekrar", false, cancelled);
  await vi.waitFor(() => expect(playback).toHaveLength(2));
  voice.silence();
  playback[1].onended();
  await Promise.resolve();
  expect(cancelled).not.toHaveBeenCalled();
  voice.close();
});
it("uses a patient default fallback while preserving an explicit silence setting", async () => {
  setup();
  const voice = new LocalVoice(callbacks(), "tr");
  await voice.connect();
  const push = (frame: Int16Array) => nodes[0].port.onmessage({ data: frame.buffer });
  for (let n = 0; n < 6; n++) push(voicedFrame());
  for (let n = 0; n < 10; n++) push(new Int16Array(1024));
  expect(backend.transcribe).not.toHaveBeenCalled();
  for (let n = 0; n < 10; n++) push(new Int16Array(1024));
  expect(backend.transcribe).toHaveBeenCalledOnce();
  voice.configureConversation({ turnEndSilence: 0.6 });
  for (let n = 0; n < 6; n++) push(voicedFrame());
  for (let n = 0; n < 10; n++) push(new Int16Array(1024));
  expect(backend.transcribe).toHaveBeenCalledTimes(2);
  voice.close();
});

it("restores Smart Turn when explicit silence is cleared and keeps manual mode manual", async () => {
  setup();
  backend.start.mockResolvedValueOnce({
    lease: "local",
    model: "small",
    device: "cuda",
    turn: true,
  } as any);
  const voice = new LocalVoice(callbacks(), "tr", undefined, undefined, { turnEndSilence: 0.6 });
  await voice.connect();
  voice.configureConversation({ turnEndSilence: undefined });
  const push = (frame: Int16Array) => nodes[0].port.onmessage({ data: frame.buffer });
  for (let n = 0; n < 6; n++) push(voicedFrame());
  for (let n = 0; n < 10; n++) push(new Int16Array(1024));
  expect(backend.endpoint).toHaveBeenCalledOnce();
  expect(backend.transcribe).not.toHaveBeenCalled();
  voice.configureConversation({ manualTurnEnd: true, turnEndSilence: undefined });
  for (let n = 0; n < 30; n++) push(new Int16Array(1024));
  expect(backend.transcribe).not.toHaveBeenCalled();
  voice.close();
});
