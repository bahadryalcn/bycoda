// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DevicePanel } from "./DevicePanel";
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
  state = "unconfigured";
  decodeQueueSize = 0;
  constructor(private init: { output: (frame: unknown) => void; error: (cause: Error) => void }) {}
  configure(config: { codec: string }) {
    this.state = "configured";
    FakeVideoDecoder.configured.push(config.codec);
  }
  decode(value: { type: string }) {
    if (value.type === "broken") return this.init.error(new Error("decode failed"));
    FakeVideoDecoder.decoded.push(value.type);
    this.init.output({ displayWidth: 50, displayHeight: 100, close: () => {} });
  }
  reset() {
    this.state = "unconfigured";
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
  await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
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
