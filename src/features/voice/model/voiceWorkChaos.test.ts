// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { stopMicrophone } from "./microphoneAccess";
import { RealtimeVoice } from "./realtimeVoice";
import { runVoiceWork, voiceWorkCall } from "./voiceWorkGuard";
import {
  VOICE_WORK_SEED_HEADER,
  VoiceWorkLedger,
  type VoiceWorkEntry,
  type VoiceWorkStorage,
} from "./voiceWorkLedger";

// Incident: a work-creating tool was in flight when the provider socket dropped. The created
// session must not be forgotten, the next session must be told about it, and the model's retry
// of the identical call for the same request must not create a second session.

const track = { stop: vi.fn(), enabled: true, onended: null as null | (() => void) };
const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
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
  onclose?: ((event?: { code: number; wasClean?: boolean }) => void) | null;
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
  constructor(options?: { sampleRate?: number }) {
    this.sampleRate = options?.sampleRate ?? 48000;
  }
  state = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.state = "closed";
  });
  audioWorklet = { addModule: vi.fn(async () => {}) };
  createMediaStreamSource = vi.fn(node);
  createGain = vi.fn(() => ({ ...node(), gain: { value: 1 } }));
  createBuffer = vi.fn(() => ({ getChannelData: () => new Float32Array(1), duration: 1 / 24000 }));
  createBufferSource = vi.fn(() => ({
    ...node(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as null | (() => void),
    buffer: null,
  }));
}
const secret = {
  value: "temporary",
  expires_at: 1,
  model: "gpt-realtime-2.1",
  url: "wss://example/openai",
};

function setup() {
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
    value: { getUserMedia: vi.fn(async () => stream) },
  });
}

function pushFrame(capture: ReturnType<typeof node>, frame: Int16Array) {
  (capture.port.onmessage as (event: { data: ArrayBuffer }) => void)({
    data: frame.buffer as ArrayBuffer,
  });
}

/** Speech, end-of-turn silence, provider commit and transcript for one owner utterance. */
function acceptInput(socket: Socket, capture: ReturnType<typeof node>, text: string) {
  const speech = Int16Array.from({ length: 1024 }, (_, i) =>
    Math.round(4000 * Math.sin((2 * Math.PI * 150 * i) / 24000)),
  );
  for (let i = 0; i < 9; i++) pushFrame(capture, speech);
  for (let i = 0; i < 30; i++) pushFrame(capture, new Int16Array(1024));
  socket.emit({ type: "input_audio_buffer.committed", item_id: "input1" });
  socket.emit({
    type: "conversation.item.created",
    item: { id: "input1", type: "message", role: "user" },
  });
  socket.emit({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "input1",
    transcript: text,
  });
}

function memoryLedger() {
  let saved: VoiceWorkEntry[] = [];
  const storage: VoiceWorkStorage = {
    load: () => saved.map((entry) => ({ ...entry })),
    save: (entries) => {
      saved = entries.map((entry) => ({ ...entry }));
    },
  };
  return new VoiceWorkLedger({ storage });
}

afterEach(() => {
  stopMicrophone(stream as unknown as MediaStream);
  sockets = [];
  captures = [];
  track.stop.mockClear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps work a dropped socket started, seeds it into the next session and refuses the identical retry", async () => {
  vi.useFakeTimers();
  setup();
  const request = "Build me a snake game in the games project";
  const projectPath = "G:\\Projects\\games";
  const args = {
    family: "workspace",
    action: "workspace.sessions.create",
    requestId: "req-first",
    input: { projectPath, prompt: request, submit: true },
  };
  const ledger = memoryLedger();
  let created!: (value: unknown) => void;
  const execute = vi.fn(
    () =>
      new Promise((resolve) => {
        created = resolve;
      }),
  );
  const diagnostic = vi.fn();
  const callbacks = {
    state: vi.fn(),
    reply: vi.fn(),
    transcript: vi.fn(),
    turnStart: vi.fn(),
    playback: vi.fn(),
    error: vi.fn(),
    diagnostic,
    tool: vi.fn(async (name: string, input: Record<string, unknown>) =>
      runVoiceWork(ledger, voiceWorkCall(name, input), request, execute),
    ),
  };
  const first = new RealtimeVoice("openai", callbacks, "en");
  const connecting = first.connect(secret);
  await vi.advanceTimersByTimeAsync(0);
  await connecting;
  const socket = sockets[0]!;
  acceptInput(socket, captures[0]!, request);
  socket.emit({ type: "response.created", response: { id: "r1" } });
  socket.emit({
    type: "response.function_call_arguments.done",
    response_id: "r1",
    call_id: "call-1",
    name: "app_tool_call",
    arguments: JSON.stringify(args),
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(execute).toHaveBeenCalledOnce();
  expect(ledger.entries()[0]).toMatchObject({ status: "running", request });

  // The provider socket drops while the session is being created; the app closes that client.
  socket.readyState = 3;
  socket.onclose?.({ code: 1006, wasClean: false });
  first.close();
  created({
    status: "accepted",
    submitted: true,
    sessionId: "session-snake",
    projectPath,
    title: "Snake game",
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(diagnostic).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "tool-result-dropped", name: "app_tool_call" }),
  );
  expect(socket.sent().some((event) => event.item?.type === "function_call_output")).toBe(false);
  expect(ledger.entries()).toHaveLength(1);
  expect(ledger.entries()[0]).toMatchObject({
    status: "done",
    sessionIds: ["session-snake"],
    title: "Snake game",
  });

  // The next provider session is seeded with the app's record, independent of any Host read.
  const second = new RealtimeVoice("openai", { ...callbacks, diagnostic: vi.fn() }, "en");
  const reconnecting = second.connect(secret, [], { voiceWork: ledger.seed() });
  await vi.advanceTimersByTimeAsync(0);
  await reconnecting;
  const seeded = JSON.stringify(sockets[1]!.sent());
  expect(seeded).toContain(VOICE_WORK_SEED_HEADER);
  expect(seeded).toContain("session session-snake");

  // The fresh model retries the identical call with a new request id for the same utterance.
  const retry = vi.fn(async () => ({ status: "accepted", sessionId: "session-second" }));
  const answer = await runVoiceWork(
    ledger,
    voiceWorkCall("app_tool_call", { ...args, requestId: "req-retry" }),
    request,
    retry,
  );
  expect(retry).not.toHaveBeenCalled();
  expect(answer).toMatchObject({
    status: "already_started",
    state: "done",
    sessionIds: ["session-snake"],
    title: "Snake game",
  });
  expect(ledger.entries()).toHaveLength(1);

  // A new owner request with the same arguments still creates new work.
  await runVoiceWork(
    ledger,
    voiceWorkCall("app_tool_call", { ...args, requestId: "req-new" }),
    "Build another snake game",
    retry,
  );
  expect(retry).toHaveBeenCalledOnce();
  second.close();
});
