// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { GrokVoice } from "./grokVoice";

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
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: ((message: { data: string }) => void) | null;
  send = vi.fn();
  close = vi.fn();
  constructor() {
    sockets.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  emit(event: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
}
class Context {
  sampleRate = 24000;
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
    onended: null,
    buffer: null,
  }));
  constructor() {
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
afterEach(() => {
  sockets = [];
  contexts = [];
  track.enabled = true;
  track.stop.mockClear();
  vi.unstubAllGlobals();
});

it("releases microphone and audio when closed; mute disables the actual input track", async () => {
  setup();
  const voice = new GrokVoice(vi.fn());
  await voice.connect("temporary");
  voice.mute(true);
  expect(track.enabled).toBe(false);
  voice.mute(false);
  expect(track.enabled).toBe(true);
  voice.close();
  expect(track.stop).toHaveBeenCalled();
  expect(contexts[0].close).toHaveBeenCalled();
  expect(sockets[0].close).toHaveBeenCalled();
});
it("silencing a response discards later audio chunks of that response", async () => {
  setup();
  const voice = new GrokVoice(vi.fn());
  await voice.connect("temporary");
  sockets[0].emit({ type: "response.created", response: { id: "r1" } });
  voice.silence();
  sockets[0].emit({ type: "response.output_audio.delta", response_id: "r1", delta: "AAA=" });
  expect(contexts[0].createBuffer).not.toHaveBeenCalled();
  sockets[0].emit({ type: "response.created", response: { id: "r2" } });
  sockets[0].emit({ type: "response.output_audio.delta", response_id: "r2", delta: "AAA=" });
  expect(contexts[0].createBuffer).toHaveBeenCalledTimes(1);
  voice.close();
});
it("releases a late permission grant after the user closes the companion", async () => {
  const getUserMedia = setup();
  let grant!: (value: unknown) => void;
  getUserMedia.mockImplementation(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }) as never,
  );
  const voice = new GrokVoice(vi.fn());
  const connection = voice.connect("temporary");
  voice.close();
  grant({ getTracks: () => [track], getAudioTracks: () => [track] });
  await connection;
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(sockets).toHaveLength(0);
});
