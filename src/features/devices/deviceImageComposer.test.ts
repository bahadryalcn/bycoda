// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  attachDeviceImage,
  attachDeviceImageAcrossWindows,
  MAX_DEVICE_SCREENSHOT_BYTES,
  registerDeviceImageComposer,
  type DeviceImageDraft,
} from "./deviceImageComposer";
import type { Attachment } from "../sessions/model/session";

const transport = vi.hoisted(() => ({
  label: "main",
  handlers: new Map<string, (event: { payload: any }) => void | Promise<void>>(),
  emit: vi.fn(),
  delayedListen: undefined as undefined | Promise<void>,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => {
    const label = transport.label;
    return {
      label,
      listen: async (event: string, handler: (event: { payload: any }) => void) => {
        await transport.delayedListen;
        const key = `${label}:${event}`;
        transport.handlers.set(key, handler);
        return () => transport.handlers.delete(key);
      },
    };
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  emitTo: async (label: string, event: string, payload: unknown) => {
    transport.emit(label, event, payload);
    await transport.handlers.get(`${label}:${event}`)?.({ payload });
  },
}));

export const image: DeviceImageDraft = {
  device: {
    id: "simulator",
    name: "iPhone",
    platform: "ios",
    version: "27",
    booted: true,
    physical: false,
  },
  computer: { label: "MacBook", target: { kind: "machine", machineId: "mac" } },
  frame: {
    mime: "image/png",
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=",
    capturedAt: "2026-10-26T10:00:00Z",
  },
  comment: "Adjust the marked area",
};
const event = "bycoda:device-image-draft";
const stops: (() => void)[] = [];
afterEach(async () => {
  stops.splice(0).forEach((stop) => stop());
  await Promise.resolve();
  transport.handlers.clear();
  transport.emit.mockClear();
  transport.label = "main";
  transport.delayedListen = undefined;
  vi.useRealTimers();
  delete (window as any).__TAURI_INTERNALS__;
});

it("accepts a standard image and its context together only for the originating draft", () => {
  const receive = vi.fn((_file: Attachment, _context: string) => true);
  stops.push(registerDeviceImageComposer("/project", "shell-session", receive));
  expect(() => attachDeviceImage("/other", "shell-session", image)).toThrow("originating");
  expect(() => attachDeviceImage("/project", "host-session", image)).toThrow("originating");
  attachDeviceImage("/project", "shell-session", image);
  expect(receive).toHaveBeenCalledOnce();
  const [file, context] = receive.mock.calls[0];
  expect(file).toMatchObject({
    kind: "image",
    name: "device-screen.png",
    mimeType: "image/png",
    data: image.frame.base64,
  });
  expect(file.browserAnnotation).toBeUndefined();
  expect(context).toContain(image.comment);
  expect(context).toContain('"machineId":"mac"');
  expect(context).toContain('"capturedAt":"2026-10-26T10:00:00Z"');
  expect(context).toContain("untrusted device metadata");
});

it("refuses invalid images, metadata and oversized payloads before touching the receiver", () => {
  const receive = vi.fn(() => true);
  stops.push(registerDeviceImageComposer("/project", "session", receive));
  for (const value of [
    { ...image, frame: { ...image.frame, base64: "YWJj" } },
    { ...image, frame: { ...image.frame, mime: "image/jpeg" } },
    { ...image, frame: { ...image.frame, capturedAt: "not-a-date" } },
    {
      ...image,
      frame: {
        ...image.frame,
        base64: "Y".repeat(Math.ceil(MAX_DEVICE_SCREENSHOT_BYTES / 3) * 4 + 4),
      },
    },
    { ...image, computer: { ...image.computer, target: { kind: "machine", machineId: "" } } },
    { ...image, comment: "a".repeat(4001) },
  ]) {
    expect(() => attachDeviceImage("/project", "session", value as DeviceImageDraft)).toThrow(
      "Invalid device",
    );
  }
  expect(receive).not.toHaveBeenCalled();
});

it("reports refusal and unregisters only the receiver it owns", () => {
  const old = registerDeviceImageComposer("/project", "session", () => true);
  stops.push(registerDeviceImageComposer("/project", "session", () => false));
  old();
  expect(() => attachDeviceImage("/project", "session", image)).toThrow("cannot accept");
});

it("waits for detached-window acceptance and deduplicates replayed request IDs", async () => {
  (window as any).__TAURI_INTERNALS__ = {};
  const receive = vi.fn((_file: Attachment, _text: string) => true);
  stops.push(registerDeviceImageComposer("/project", "session", receive));
  await vi.waitFor(() => expect(transport.handlers.has(`main:${event}`)).toBe(true));
  vi.resetModules();
  const detached = await import("./deviceImageComposer");
  transport.label = "tools-window";
  await detached.attachDeviceImageAcrossWindows("/project", "session", image, "main");
  expect(receive).toHaveBeenCalledOnce();
  const request = transport.emit.mock.calls[0][2];
  expect(request).toMatchObject({ cwd: "/project", sessionId: "session", replyTo: "tools-window" });
  await transport.handlers.get(`main:${event}`)!({ payload: request });
  expect(receive).toHaveBeenCalledOnce();
  expect(transport.handlers.has(`tools-window:${event}-ack`)).toBe(false);
});

it("ignores another conversation and rejects malformed events at the receiving boundary", async () => {
  (window as any).__TAURI_INTERNALS__ = {};
  const receive = vi.fn(() => true);
  stops.push(registerDeviceImageComposer("/project", "session", receive));
  await vi.waitFor(() => expect(transport.handlers.has(`main:${event}`)).toBe(true));
  const request = {
    id: "request",
    cwd: "/project",
    sessionId: "session",
    image,
    replyTo: "tools-window",
  };
  const handle = transport.handlers.get(`main:${event}`)!;
  await handle({ payload: { ...request, cwd: "/other" } });
  await handle({ payload: { ...request, sessionId: "other" } });
  expect(transport.emit).not.toHaveBeenCalled();
  await handle({
    payload: { ...request, image: { ...image, frame: { ...image.frame, base64: "YWJj" } } },
  });
  expect(receive).not.toHaveBeenCalled();
  expect(transport.emit).toHaveBeenCalledWith("tools-window", `${event}-ack`, {
    id: "request",
    accepted: false,
  });
});

it("cleans late listeners without sending after an unacknowledged timeout", async () => {
  vi.useFakeTimers();
  transport.label = "tools-window";
  let finish!: () => void;
  transport.delayedListen = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const result = attachDeviceImageAcrossWindows("/project", "missing", image, "main");
  const rejected = expect(result).rejects.toThrow("Check the originating conversation");
  await vi.advanceTimersByTimeAsync(2500);
  await rejected;
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(transport.emit).not.toHaveBeenCalled();
  expect(transport.handlers.has(`tools-window:${event}-ack`)).toBe(false);
});
