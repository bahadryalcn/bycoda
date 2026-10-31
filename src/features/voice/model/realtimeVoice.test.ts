// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { RealtimeVoice, realtimeSession } from "./realtimeVoice";

const track = { stop: vi.fn(), enabled: true };
const node = () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  port: { onmessage: null as unknown },
});
let sockets: Socket[] = [];
let contexts: Context[] = [];
class Socket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  onopen?: () => void;
  onclose?: (() => void) | null;
  onerror?: (() => void) | null;
  onmessage?: ((message: { data: string }) => void) | null;
  send = vi.fn();
  close = vi.fn();
  constructor(
    public url: string,
    public protocols: string[],
  ) {
    sockets.push(this);
    queueMicrotask(() => {
      this.onopen?.();
      // The provider confirms the session; connect resolves on it.
      queueMicrotask(() => this.emit({ type: "session.updated" }));
    });
  }
  emit(event: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  sent() {
    return this.send.mock.calls.map(([data]) => JSON.parse(data as string));
  }
}
class Context {
  sampleRate: number;
  state = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.state = "closed";
  });
  audioWorklet = { addModule: vi.fn(async () => {}) };
  createMediaStreamSource = vi.fn(node);
  createBuffer = vi.fn(() => ({ getChannelData: () => new Float32Array(1), duration: 1 / 24000 }));
  createBufferSource = vi.fn(() => ({
    ...node(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as null | (() => void),
    buffer: null,
  }));
  constructor(options?: { sampleRate?: number }) {
    this.sampleRate = options?.sampleRate ?? 48000;
    contexts.push(this);
  }
}
function setup() {
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      constructor() {
        return node();
      }
    },
  );
  const getUserMedia = vi.fn(async () => ({
    getTracks: () => [track],
    getAudioTracks: () => [track],
  }));
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  return getUserMedia;
}
const callbacks = () => ({
  state: vi.fn(),
  reply: vi.fn(),
  transcript: vi.fn(),
  playback: vi.fn(),
  tool: vi.fn(async (): Promise<unknown> => ({ accepted: true })),
  error: vi.fn(),
});
const secret = (provider: "xai" | "openai") => ({
  value: "temporary",
  expires_at: 1,
  model: provider === "xai" ? "grok-voice-latest" : "gpt-realtime-2.1",
  url: `wss://example/${provider}`,
});
afterEach(() => {
  sockets = [];
  contexts = [];
  track.enabled = true;
  track.stop.mockClear();
  vi.unstubAllGlobals();
});

it("authenticates per provider and configures noise-tolerant server turn detection", async () => {
  setup();
  const openai = new RealtimeVoice("openai", callbacks(), "tr");
  await openai.connect(secret("openai"));
  expect(sockets[0].protocols).toEqual(["realtime", "openai-insecure-api-key.temporary"]);
  const update = sockets[0].sent()[0];
  expect(update.session).toMatchObject({
    type: "realtime",
    model: "gpt-realtime-2.1",
    audio: { input: { turn_detection: { type: "semantic_vad" } } },
  });
  expect(update.session.instructions).toContain("interface language: tr");
  const xai = new RealtimeVoice("xai", callbacks(), "en");
  await xai.connect(secret("xai"));
  expect(sockets[1].protocols).toEqual(["xai-client-secret.temporary"]);
  expect(sockets[1].sent()[0].session.turn_detection).toMatchObject({
    type: "server_vad",
    threshold: 0.6,
  });
  expect(realtimeSession("xai", "m", "en").tools.map((tool) => tool.name)).toEqual([
    "session_context",
    "submit_work",
    "stop_work",
  ]);
  openai.close();
  xai.close();
});

it("runs a tool call once, returns its output and continues after the response ends", async () => {
  setup();
  const events = callbacks();
  const voice = new RealtimeVoice("openai", events, "tr");
  await voice.connect(secret("openai"));
  const socket = sockets[0];
  socket.emit({ type: "response.created", response: { id: "r1" } });
  const call = { call_id: "c1", name: "submit_work", arguments: '{"text":"Testleri çalıştır"}' };
  socket.emit({ type: "response.function_call_arguments.done", ...call });
  // The same call repeated in response.done is not run twice.
  socket.emit({
    type: "response.done",
    response: { output: [{ type: "function_call", ...call }] },
  });
  await vi.waitFor(() =>
    expect(socket.sent().map((event) => event.type)).toContain("response.create"),
  );
  expect(events.tool).toHaveBeenCalledExactlyOnceWith("submit_work", {
    text: "Testleri çalıştır",
  });
  const output = socket.sent().find((event) => event.type === "conversation.item.create");
  expect(output.item).toEqual({
    type: "function_call_output",
    call_id: "c1",
    output: '{"accepted":true}',
  });
  voice.close();
});

it("barge-in stops current playback and discards later audio of that response", async () => {
  setup();
  const events = callbacks();
  const voice = new RealtimeVoice("xai", events, "tr");
  await voice.connect(secret("xai"));
  const socket = sockets[0];
  const output = contexts[1];
  socket.emit({ type: "response.created", response: { id: "r1" } });
  socket.emit({ type: "response.output_audio.delta", response_id: "r1", delta: "AAA=" });
  expect(output.createBuffer).toHaveBeenCalledTimes(1);
  expect(events.playback).toHaveBeenLastCalledWith(true);
  const player = output.createBufferSource.mock.results[0].value;
  socket.emit({ type: "input_audio_buffer.speech_started" });
  expect(player.stop).toHaveBeenCalled();
  expect(events.playback).toHaveBeenLastCalledWith(false);
  expect(events.state).toHaveBeenLastCalledWith("speaking");
  socket.emit({ type: "response.output_audio.delta", response_id: "r1", delta: "AAA=" });
  expect(output.createBuffer).toHaveBeenCalledTimes(1);
  socket.emit({ type: "response.created", response: { id: "r2" } });
  socket.emit({ type: "response.output_audio.delta", response_id: "r2", delta: "AAA=" });
  expect(output.createBuffer).toHaveBeenCalledTimes(2);
  voice.close();
});

it("releases microphone, audio and socket when closed; mute disables the input track", async () => {
  setup();
  const voice = new RealtimeVoice("xai", callbacks(), "tr");
  await voice.connect(secret("xai"));
  voice.mute(true);
  expect(track.enabled).toBe(false);
  voice.mute(false);
  expect(track.enabled).toBe(true);
  voice.close();
  expect(track.stop).toHaveBeenCalled();
  expect(contexts.every((context) => context.close.mock.calls.length === 1)).toBe(true);
  expect(sockets[0].close).toHaveBeenCalled();
});

it("reports a dropped connection as fatal and releases a late permission grant", async () => {
  const getUserMedia = setup();
  const events = callbacks();
  const voice = new RealtimeVoice("openai", events, "tr");
  await voice.connect(secret("openai"));
  sockets[0].onclose?.();
  expect(events.error).toHaveBeenCalledWith("Voice connection closed. Start voice again.", true);

  let grant!: (value: unknown) => void;
  getUserMedia.mockImplementation(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }) as never,
  );
  const late = new RealtimeVoice("xai", callbacks(), "tr");
  const connection = late.connect(secret("xai"));
  late.close();
  grant({ getTracks: () => [track], getAudioTracks: () => [track] });
  await connection;
  expect(sockets).toHaveLength(1);
});

it("uses the chosen speaker voice for each provider and the provider default otherwise", () => {
  expect(realtimeSession("xai", "m", "tr", "rex").voice).toBe("rex");
  expect(realtimeSession("xai", "m", "tr").voice).toBe("eve");
  const openai = realtimeSession("openai", "m", "tr", "cedar") as {
    audio: { output: { voice: string } };
  };
  expect(openai.audio.output.voice).toBe("cedar");
});
