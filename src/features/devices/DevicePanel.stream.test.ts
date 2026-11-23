// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DevicePanel } from "./DevicePanel";
import { DECODE_QUEUE_LIMIT } from "./model/liveStreamRecovery";
import type { DeviceHostStatus, DevicePanelApi, DeviceStreamChunk } from "./types";

const status: DeviceHostStatus = {
  running: true,
  installed: true,
  agentInstalled: true,
  controlProtocol: 1,
  platform: "win32",
  platforms: [{ platform: "android", available: true }],
};
const device = {
  id: "emulator",
  name: "Android emulator",
  platform: "android" as const,
  version: "16",
  booted: true,
  physical: false,
};
// SPS, PPS and one IDR slice: a complete key picture.
const keyBytes = [
  0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x2a, 0, 0, 0, 1, 0x68, 0xce, 1, 0, 0, 0, 1, 0x65, 0xb8, 0,
];
const keyPicture = btoa(keyBytes.map((value) => String.fromCharCode(value)).join(""));
const chunk = (value: Partial<DeviceStreamChunk>): DeviceStreamChunk => ({
  cursor: 0,
  reset: false,
  base64: "",
  width: 100,
  height: 200,
  ...value,
});
const makeApi = (stream: DevicePanelApi["stream"]): DevicePanelApi => ({
  status: vi.fn().mockResolvedValue(status),
  setup: vi.fn().mockResolvedValue(status),
  start: vi.fn().mockResolvedValue(status),
  stop: vi.fn().mockResolvedValue({ ...status, running: false }),
  list: vi.fn().mockResolvedValue({ devices: [device], errors: [] }),
  boot: vi.fn().mockResolvedValue(device),
  capture: vi.fn().mockResolvedValue({ mime: "image/png", base64: "frame", capturedAt: "now" }),
  stream,
  action: vi.fn().mockResolvedValue("Done"),
  controlStatus: vi.fn().mockResolvedValue({ deviceId: device.id, busy: false }),
  claimControl: vi.fn().mockResolvedValue({
    deviceId: device.id,
    leaseId: "test-lease",
    expiresAt: Date.now() + 60_000,
  }),
  releaseControl: vi.fn().mockResolvedValue({ released: true }),
});

/** Minimal WebCodecs stand-in: every decoded chunk yields one picture. */
class FakeVideoDecoder {
  static configured: string[] = [];
  static decoded: string[] = [];
  static instances = 0;
  static resets = 0;
  /** Decoding never catches up while true: every decoded chunk stays queued. */
  static stalled = false;
  static maxQueue = 0;
  /** The next decode fails the way a real decoder does: it reports the error and closes. */
  static failNext = false;
  static queue = 0;
  state = "unconfigured";
  get decodeQueueSize() {
    return FakeVideoDecoder.queue;
  }
  constructor(private init: { output: (frame: unknown) => void; error: (cause: Error) => void }) {
    FakeVideoDecoder.instances++;
  }
  configure(config: { codec: string }) {
    this.state = "configured";
    FakeVideoDecoder.configured.push(config.codec);
  }
  decode(value: { type: string }) {
    if (value.type === "broken" || FakeVideoDecoder.failNext) {
      FakeVideoDecoder.failNext = false;
      this.state = "closed";
      return this.init.error(new Error("decode failed"));
    }
    FakeVideoDecoder.decoded.push(value.type);
    if (FakeVideoDecoder.stalled) {
      FakeVideoDecoder.queue++;
      FakeVideoDecoder.maxQueue = Math.max(FakeVideoDecoder.maxQueue, FakeVideoDecoder.queue);
    }
    this.init.output({ displayWidth: 50, displayHeight: 100, close: () => {} });
  }
  reset() {
    this.state = "unconfigured";
    FakeVideoDecoder.resets++;
    FakeVideoDecoder.queue = 0;
  }
  close() {
    this.state = "closed";
  }
}

let container: HTMLDivElement;
let root: Root;
const button = (text: string) =>
  [...document.body.querySelectorAll("button")].find(
    (node) => (node.getAttribute("aria-label") ?? node.textContent) === text,
  )!;
const settle = () => act(async () => vi.advanceTimersByTimeAsync(300));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("VideoDecoder", FakeVideoDecoder);
  vi.stubGlobal(
    "EncodedVideoChunk",
    class {
      type: string;
      constructor(init: { type: string }) {
        this.type = init.type;
      }
    },
  );
  FakeVideoDecoder.configured = [];
  FakeVideoDecoder.decoded = [];
  FakeVideoDecoder.instances = 0;
  FakeVideoDecoder.resets = 0;
  FakeVideoDecoder.stalled = false;
  FakeVideoDecoder.maxQueue = 0;
  FakeVideoDecoder.failNext = false;
  FakeVideoDecoder.queue = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("follows the screen as video and stops still captures once the stream decodes", async () => {
  const stream = vi
    .fn<NonNullable<DevicePanelApi["stream"]>>()
    .mockResolvedValueOnce(chunk({ cursor: 22, reset: true, base64: keyPicture }))
    .mockReturnValue(new Promise(() => {}));
  const api = makeApi(stream);
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await settle();
  expect(stream.mock.calls.slice(0, 2)).toEqual([
    ["emulator", undefined],
    ["emulator", 22],
  ]);
  expect(FakeVideoDecoder.configured).toEqual(["avc1.42c02a"]);
  expect(FakeVideoDecoder.decoded).toEqual(["key"]);
  expect(container.querySelector("canvas.device-panel-live")).not.toBeNull();
  const captures = vi.mocked(api.capture).mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(api.capture).toHaveBeenCalledTimes(captures);
  // Input no longer waits for a follow-up screenshot: the video shows the result.
  await act(async () => button("Home").click());
  expect(api.action).toHaveBeenCalledTimes(1);
  expect(api.capture).toHaveBeenCalledTimes(captures);
  expect(container.querySelector(".device-panel-frame-state")).toBeNull();
  // Pausing ends the video and keeps the still frame.
  await act(async () => button("Live view").click());
  expect(container.querySelector("canvas.device-panel-live")).toBeNull();
  expect(container.querySelector("img")).not.toBeNull();
});

it("falls back to still captures when the Host cannot stream this device", async () => {
  const stream = vi
    .fn<NonNullable<DevicePanelApi["stream"]>>()
    .mockRejectedValue(new Error("DEVICE_STREAM_UNSUPPORTED: iOS simulators are not streamed."));
  const api = makeApi(stream);
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await settle();
  expect(stream).toHaveBeenCalledTimes(1);
  expect(container.querySelector("canvas.device-panel-live")).toBeNull();
  expect(container.querySelector(".device-panel-error")).toBeNull();
  const captures = vi.mocked(api.capture).mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(vi.mocked(api.capture).mock.calls.length).toBeGreaterThan(captures);
});

it("shows and controls the video while the initial still capture is pending", async () => {
  const stream = vi
    .fn<NonNullable<DevicePanelApi["stream"]>>()
    .mockResolvedValueOnce(chunk({ cursor: 22, reset: true, base64: keyPicture }))
    .mockReturnValue(new Promise(() => {}));
  const api = makeApi(stream);
  let finishCapture!: (value: Awaited<ReturnType<DevicePanelApi["capture"]>>) => void;
  vi.mocked(api.capture).mockReturnValue(
    new Promise((resolve) => {
      finishCapture = resolve;
    }),
  );
  const encode = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL");
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await settle();
  expect(container.querySelector("canvas.device-panel-live")).not.toBeNull();
  expect(encode).not.toHaveBeenCalled();
  await act(async () => finishCapture({ mime: "image/png", base64: "frame", capturedAt: "now" }));
  const preview = container.querySelector(".device-panel-preview-control")!;
  await act(async () =>
    preview.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(api.action).toHaveBeenCalledWith(
    device.id,
    { type: "press", x: 50, y: 100 },
    "test-lease",
  );
  encode.mockRestore();
});

it("waits for a key picture after a reset and ignores a stream without WebCodecs", async () => {
  const delta = btoa(String.fromCharCode(0, 0, 0, 1, 0x41, 0x9a, 0x01));
  const stream = vi
    .fn<NonNullable<DevicePanelApi["stream"]>>()
    .mockResolvedValueOnce(chunk({ cursor: 7, reset: true, base64: delta }))
    .mockResolvedValueOnce(chunk({ cursor: 29, reset: true, base64: keyPicture }))
    .mockReturnValue(new Promise(() => {}));
  await act(async () => root.render(createElement(DevicePanel, { api: makeApi(stream) })));
  await settle();
  expect(FakeVideoDecoder.decoded).toEqual(["key"]);
  act(() => root.unmount());
  vi.stubGlobal("VideoDecoder", undefined);
  const unused = vi.fn<NonNullable<DevicePanelApi["stream"]>>();
  root = createRoot(container);
  await act(async () => root.render(createElement(DevicePanel, { api: makeApi(unused) })));
  await settle();
  expect(unused).not.toHaveBeenCalled();
});

const advance = (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms));
const transient = () => new Error("RPC_WS_DEADLINE: The Host did not answer in time.");

function pushStream() {
  const subscriptions: {
    chunk: (value: DeviceStreamChunk) => void;
    fail: (cause: unknown) => void;
    close: ReturnType<typeof vi.fn>;
  }[] = [];
  const subscribe = vi.fn<NonNullable<DevicePanelApi["subscribeStream"]>>(
    async (_, chunk, fail) => {
      const close = vi.fn();
      subscriptions.push({ chunk, fail, close });
      return close;
    },
  );
  return { subscribe, subscriptions };
}

it("retries an established push subscription and fences callbacks from the old subscription", async () => {
  const { subscribe, subscriptions } = pushStream();
  const stream = vi.fn<NonNullable<DevicePanelApi["stream"]>>();
  const api = { ...makeApi(stream), subscribeStream: subscribe };
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await settle();
  const key = chunk({ cursor: 22, reset: true, base64: keyPicture });
  await act(async () =>
    subscriptions[0]!.chunk(
      chunk({
        cursor: 19,
        reset: true,
        boundary: false,
        base64: btoa(String.fromCharCode(...keyBytes.slice(0, 19))),
      }),
    ),
  );
  expect(FakeVideoDecoder.decoded).toEqual([]);
  await act(async () =>
    subscriptions[0]!.chunk(
      chunk({
        cursor: 22,
        boundary: true,
        base64: btoa(String.fromCharCode(...keyBytes.slice(19))),
      }),
    ),
  );
  expect(FakeVideoDecoder.decoded).toEqual(["key"]);
  await act(async () => subscriptions[0]!.fail(transient()));
  expect(subscriptions[0]!.close).toHaveBeenCalledOnce();
  expect(container.querySelector("canvas.device-panel-live")).toBeNull();
  await advance(600);
  expect(subscribe).toHaveBeenCalledTimes(2);
  await act(async () => subscriptions[0]!.chunk(key));
  expect(FakeVideoDecoder.decoded).toEqual(["key"]);
  await act(async () => subscriptions[1]!.chunk(key));
  expect(FakeVideoDecoder.decoded).toEqual(["key", "key"]);
  expect(stream).not.toHaveBeenCalled();
});

it.each(["gap", "backlog"])("opens a fresh push subscription after a %s", async (reason) => {
  const { subscribe, subscriptions } = pushStream();
  const api = { ...makeApi(undefined), subscribeStream: subscribe };
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await settle();
  const key = chunk({ cursor: 22, reset: true, base64: keyPicture });
  const delta = btoa(String.fromCharCode(0, 0, 0, 1, 0x41, 0x9a, 0x01));
  await act(async () => subscriptions[0]!.chunk(key));
  await act(async () => {
    if (reason === "gap") {
      subscriptions[0]!.chunk(chunk({ cursor: 44, base64: delta }));
    } else {
      for (let index = 0; index < 20; index++) {
        subscriptions[0]!.chunk(chunk({ cursor: 22 + (index + 1) * 7, base64: delta }));
      }
    }
  });
  expect(subscriptions[0]!.close).toHaveBeenCalledOnce();
  expect(FakeVideoDecoder.decoded).toEqual(["key"]);
  expect(container.querySelector("canvas.device-panel-live")).toBeNull();
  await advance(600);
  expect(subscribe).toHaveBeenCalledTimes(2);
  await act(async () => subscriptions[1]!.chunk(key));
  expect(FakeVideoDecoder.decoded).toEqual(["key", "key"]);
});

it("uses cursor polling when push setup fails", async () => {
  const subscribeStream = vi
    .fn<NonNullable<DevicePanelApi["subscribeStream"]>>()
    .mockRejectedValue(new Error("Unsupported host method"));
  const stream = vi
    .fn<NonNullable<DevicePanelApi["stream"]>>()
    .mockResolvedValueOnce(chunk({ cursor: 22, reset: true, base64: keyPicture }))
    .mockReturnValue(new Promise(() => {}));
  const api = { ...makeApi(stream), subscribeStream };
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await settle();
  expect(subscribeStream).toHaveBeenCalledOnce();
  expect(stream.mock.calls).toEqual([
    [device.id, undefined],
    [device.id, 22],
  ]);
  expect(FakeVideoDecoder.decoded).toEqual(["key"]);
});

it("does not fall back to polling if push setup is denied", async () => {
  const subscribeStream = vi
    .fn<NonNullable<DevicePanelApi["subscribeStream"]>>()
    .mockRejectedValue(new Error("Host rejected request [RPC_AUTHORIZATION]"));
  const stream = vi.fn<NonNullable<DevicePanelApi["stream"]>>();
  const api = { ...makeApi(stream), subscribeStream };
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await settle();
  await advance(5000);
  expect(subscribeStream).toHaveBeenCalledOnce();
  expect(stream).not.toHaveBeenCalled();
});

it("cleans up a subscription whose handle arrives after unmount", async () => {
  const close = vi.fn();
  let finish!: (cleanup: () => void) => void;
  const subscribeStream = vi.fn<NonNullable<DevicePanelApi["subscribeStream"]>>(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const api = { ...makeApi(undefined), subscribeStream };
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await settle();
  act(() => root.unmount());
  await act(async () => finish(close));
  expect(close).toHaveBeenCalledOnce();
  root = createRoot(container);
});

it("retries a transient stream failure from a fresh key picture and returns to video", async () => {
  const stream = vi
    .fn<NonNullable<DevicePanelApi["stream"]>>()
    .mockResolvedValueOnce(chunk({ cursor: 22, reset: true, base64: keyPicture }))
    .mockRejectedValueOnce(transient())
    .mockResolvedValueOnce(chunk({ cursor: 44, reset: true, base64: keyPicture }))
    .mockReturnValue(new Promise(() => {}));
  await act(async () => root.render(createElement(DevicePanel, { api: makeApi(stream) })));
  await settle();
  // Backing off: the frozen picture is gone, so it cannot pass as live.
  expect(stream).toHaveBeenCalledTimes(2);
  expect(container.querySelector("canvas.device-panel-live")).toBeNull();
  await advance(600);
  // The retry reads the same device from the start of the stream, not from the old cursor.
  expect(stream.mock.calls[2]).toEqual(["emulator", undefined]);
  expect(FakeVideoDecoder.decoded).toEqual(["key", "key"]);
  expect(container.querySelector("canvas.device-panel-live")).not.toBeNull();
});

it("gives up after the retry cap and keeps still captures", async () => {
  const stream = vi.fn<NonNullable<DevicePanelApi["stream"]>>().mockRejectedValue(transient());
  const api = makeApi(stream);
  await act(async () => root.render(createElement(DevicePanel, { api })));
  await settle();
  await advance(3600);
  expect(stream).toHaveBeenCalledTimes(4);
  expect(stream.mock.calls.every(([, cursor]) => cursor === undefined)).toBe(true);
  await advance(10_000);
  expect(stream).toHaveBeenCalledTimes(4);
  expect(container.querySelector("canvas.device-panel-live")).toBeNull();
  const captures = vi.mocked(api.capture).mock.calls.length;
  await advance(2000);
  expect(vi.mocked(api.capture).mock.calls.length).toBeGreaterThan(captures);
});

it.each([
  "DEVICE_AUTHORITY_REVOKED: Device access changed.",
  "Host rejected request [RPC_AUTHORIZATION]",
  "Boot the device before viewing",
])("does not retry a failure no retry can fix: %s", async (message) => {
  const stream = vi
    .fn<NonNullable<DevicePanelApi["stream"]>>()
    .mockRejectedValue(new Error(message));
  await act(async () => root.render(createElement(DevicePanel, { api: makeApi(stream) })));
  await settle();
  await advance(5000);
  expect(stream).toHaveBeenCalledTimes(1);
  expect(container.querySelector("canvas.device-panel-live")).toBeNull();
});

it("replaces a decoder that reported an error and decodes again from a key picture", async () => {
  FakeVideoDecoder.failNext = true;
  const stream = vi
    .fn<NonNullable<DevicePanelApi["stream"]>>()
    .mockResolvedValueOnce(chunk({ cursor: 22, reset: true, base64: keyPicture }))
    .mockResolvedValueOnce(chunk({ cursor: 44, reset: true, base64: keyPicture }))
    .mockReturnValue(new Promise(() => {}));
  await act(async () => root.render(createElement(DevicePanel, { api: makeApi(stream) })));
  await settle();
  expect(FakeVideoDecoder.decoded).toEqual([]);
  expect(container.querySelector("canvas.device-panel-live")).toBeNull();
  await advance(600);
  expect(stream.mock.calls[1]).toEqual(["emulator", undefined]);
  expect(FakeVideoDecoder.instances).toBe(2);
  expect(FakeVideoDecoder.configured).toEqual(["avc1.42c02a", "avc1.42c02a"]);
  expect(FakeVideoDecoder.decoded).toEqual(["key"]);
  expect(container.querySelector("canvas.device-panel-live")).not.toBeNull();
});

it("drops a decode backlog and resumes at the next key picture instead of lagging behind", async () => {
  FakeVideoDecoder.stalled = true;
  const delta = [0, 0, 0, 1, 0x41, 0x9a, 0x01];
  const burst = btoa(
    [...keyBytes, ...Array.from({ length: 20 }, () => delta).flat()]
      .map((value) => String.fromCharCode(value))
      .join(""),
  );
  const stream = vi
    .fn<NonNullable<DevicePanelApi["stream"]>>()
    .mockResolvedValueOnce(chunk({ cursor: 500, reset: true, base64: burst }))
    .mockResolvedValueOnce(chunk({ cursor: 600, base64: keyPicture }))
    .mockReturnValue(new Promise(() => {}));
  await act(async () => root.render(createElement(DevicePanel, { api: makeApi(stream) })));
  await settle();
  await advance(600);
  // The queue stalls at the limit, its backlog is discarded, and the rest of the burst's
  // deltas are skipped: nothing is decoded on top of a broken reference chain.
  expect(FakeVideoDecoder.decoded).toEqual(["key", ...Array(8).fill("delta"), "key"]);
  expect(FakeVideoDecoder.maxQueue).toBeLessThanOrEqual(DECODE_QUEUE_LIMIT + 1);
  expect(FakeVideoDecoder.configured).toEqual(["avc1.42c02a", "avc1.42c02a"]);
  expect(container.querySelector("canvas.device-panel-live")).not.toBeNull();
});

it("does not read again once viewing ends during a retry backoff", async () => {
  const stream = vi
    .fn<NonNullable<DevicePanelApi["stream"]>>()
    .mockRejectedValueOnce(transient())
    .mockReturnValue(new Promise(() => {}));
  await act(async () => root.render(createElement(DevicePanel, { api: makeApi(stream) })));
  await settle();
  expect(stream).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  await advance(5000);
  expect(stream).toHaveBeenCalledTimes(1);
  root = createRoot(container);
});
