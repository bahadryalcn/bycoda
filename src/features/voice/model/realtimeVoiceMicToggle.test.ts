// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { RealtimeVoice } from "./realtimeVoice";

const track = { stop: vi.fn(), enabled: true, onended: null as null | (() => void) };
const node = () => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  port: { onmessage: null as unknown },
});
let sockets: Socket[] = [];
let captures: ReturnType<typeof node>[] = [];
class Socket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  onopen?: () => void;
  onclose?: (() => void) | null;
  onerror?: (() => void) | null;
  onmessage?: ((message: { data: string }) => void) | null;
  send = vi.fn((raw: string) => {
    const event = JSON.parse(raw);
    if (event.type === "conversation.item.delete")
      this.emit({ type: "conversation.item.deleted", item_id: event.item_id });
  });
  close = vi.fn();
  constructor(public url: string) {
    sockets.push(this);
    queueMicrotask(() => {
      this.onopen?.();
      queueMicrotask(() => this.emit({ type: "session.updated" }));
    });
  }
  emit(event: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  sent(type: string) {
    return this.send.mock.calls
      .map(([data]) => JSON.parse(data))
      .filter((event) => event.type === type);
  }
}
class Context {
  sampleRate: number;
  state = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  audioWorklet = { addModule: vi.fn(async () => {}) };
  createMediaStreamSource = vi.fn(node);
  createGain = vi.fn(() => ({ ...node(), gain: { value: 1 } }));
  constructor(options?: { sampleRate?: number }) {
    this.sampleRate = options?.sampleRate ?? 48000;
  }
}
const callbacks = () => ({
  state: vi.fn(),
  reply: vi.fn(),
  transcript: vi.fn(),
  playback: vi.fn(),
  tool: vi.fn(async (): Promise<unknown> => ({ accepted: true })),
  error: vi.fn(),
});

async function connect(provider: "xai" | "openai") {
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("AudioContext", Context);
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      constructor() {
        const capture = node();
        captures.push(capture);
        return capture;
      }
    },
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [track],
        getAudioTracks: () => [track],
      })),
    },
  });
  const events = callbacks();
  const voice = new RealtimeVoice(provider, events, "tr");
  await voice.connect({
    value: "temporary",
    expires_at: 1,
    model: "model",
    url: `wss://example/${provider}`,
  });
  return { voice, events, socket: sockets.at(-1)! };
}

/** One spoken utterance: local VAD commits it, the provider inserts and transcribes it. */
function say(socket: Socket, id: string, text?: string) {
  const push = (frame: Int16Array) =>
    (captures.at(-1)!.port.onmessage as (event: { data: ArrayBuffer }) => void)({
      data: frame.buffer as ArrayBuffer,
    });
  const speech = Int16Array.from({ length: 1024 }, (_, i) =>
    Math.round(4000 * Math.sin((2 * Math.PI * 150 * i) / 24000)),
  );
  for (let i = 0; i < 9; i++) push(speech);
  for (let i = 0; i < 30; i++) push(new Int16Array(1024));
  socket.emit({ type: "input_audio_buffer.committed", item_id: id });
  socket.emit({ type: "conversation.item.added", item: { id, type: "message", role: "user" } });
  if (text !== undefined)
    socket.emit({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: id,
      transcript: text,
    });
}

afterEach(() => {
  sockets = [];
  captures = [];
  track.enabled = true;
  vi.unstubAllGlobals();
});

it.each([
  ["without a code or event id", {}],
  ["with a code but no event id", { code: "response_cancel_not_active" }],
  ["with another code", { type: "invalid_request_error", code: "invalid_request_error" }],
])("keeps the session and the next reply after a late cancel is refused %s", async (_, shape) => {
  const { voice, events, socket } = await connect("xai");
  say(socket, "first", "Selam Arif.");
  socket.emit({ type: "response.created", response: { id: "r1" } });
  say(socket, "second", "Selam Arif.");
  expect(socket.sent("response.cancel")).toHaveLength(1);
  // The reply had already finished on the provider when the cancel arrived.
  socket.emit({ type: "response.done", response: { id: "r1", status: "completed" } });
  expect(socket.sent("response.create")).toHaveLength(2);
  socket.emit({
    type: "error",
    error: { ...shape, message: "Cancellation failed: no active response found" },
  });
  expect(events.error).not.toHaveBeenCalled();
  expect(socket.close).not.toHaveBeenCalled();
  socket.emit({ type: "response.created", response: { id: "r2" } });
  socket.emit({
    type: "response.output_audio_transcript.delta",
    response_id: "r2",
    delta: "Selam",
  });
  expect(events.reply).toHaveBeenCalledWith("Selam", false, "r2");
  expect(socket.sent("response.cancel")).toHaveLength(1);
  voice.close();
});

it("still reports a refused cancel this connection never sent", async () => {
  const { voice, events, socket } = await connect("openai");
  socket.emit({
    type: "error",
    error: { message: "Cancellation failed: no active response found" },
  });
  expect(events.error).toHaveBeenCalledOnce();
  voice.close();
});

it("hears and answers the owner again after the microphone is toggled off and on", async () => {
  const { voice, events, socket } = await connect("xai");
  say(socket, "first", "Selam Arif.");
  socket.emit({ type: "response.created", response: { id: "r1" } });
  socket.emit({ type: "response.done", response: { id: "r1", status: "completed" } });
  voice.mute(true);
  expect(track.enabled).toBe(false);
  voice.mute(false);
  expect(track.enabled).toBe(true);
  say(socket, "second", "Selam Arif.");
  expect(events.transcript).toHaveBeenCalledTimes(2);
  expect(socket.sent("response.create")).toHaveLength(2);
  expect(events.error).not.toHaveBeenCalled();
  voice.close();
});

it("still answers an accepted turn when the microphone is toggled before its reply starts", async () => {
  const { voice, events, socket } = await connect("xai");
  say(socket, "first", "Selam Arif.");
  socket.emit({ type: "response.created", response: { id: "r1" } });
  // Accepted and shown while the previous reply is still being cancelled.
  say(socket, "second", "Nasılsın?");
  expect(events.transcript).toHaveBeenCalledTimes(2);
  voice.mute(true);
  voice.mute(false);
  socket.emit({ type: "response.done", response: { id: "r1", status: "cancelled" } });
  expect(socket.sent("response.create")).toHaveLength(2);
  voice.close();
});

it("does not let speech committed before a microphone toggle block the next utterance", async () => {
  const { voice, events, socket } = await connect("xai");
  say(socket, "first");
  voice.mute(true);
  voice.mute(false);
  socket.emit({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "first",
    transcript: "Selam Arif.",
  });
  expect(events.transcript).not.toHaveBeenCalled();
  say(socket, "second", "Selam Arif.");
  expect(events.transcript).toHaveBeenCalledOnce();
  expect(socket.sent("response.create")).toHaveLength(1);
  voice.close();
});
