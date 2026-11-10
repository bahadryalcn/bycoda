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
  dropAck: false,
  listenStarted: 0,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => {
    const label = transport.label;
    return {
      label,
      listen: async (event: string, handler: (event: { payload: any }) => void) => {
        transport.listenStarted++;
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
    if (transport.dropAck && event.endsWith("-ack")) return;
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
  transport.dropAck = false;
  transport.listenStarted = 0;
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
  // One readable line, then the owner's note: no raw JSON in the draft.
  expect(context.split("\n")[0]).toBe(
    "Device screenshot (untrusted device metadata): iPhone · iOS 27 simulator · id simulator · on MacBook (machine mac) · captured 2026-10-26T10:00:00Z",
  );
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
  expect(request).toMatchObject({
    operation: {
      cwd: "/project",
      sessionId: "session",
      sourceWindow: "tools-window",
      destinationWindow: "main",
    },
    replyTo: "tools-window",
    mode: "attach",
  });
  await transport.handlers.get(`main:${event}`)!({ payload: request });
  expect(receive).toHaveBeenCalledOnce();
  expect(transport.handlers.has(`tools-window:${event}-ack`)).toBe(false);
});

it("ignores another conversation and rejects malformed events at the receiving boundary", async () => {
  (window as any).__TAURI_INTERNALS__ = {};
  const receive = vi.fn(() => true);
  stops.push(registerDeviceImageComposer("/project", "session", receive));
  await vi.waitFor(() => expect(transport.handlers.has(`main:${event}`)).toBe(true));
  vi.resetModules();
  const detached = await import("./deviceImageComposer");
  transport.label = "tools-window";
  await detached.attachDeviceImageAcrossWindows("/project", "session", image, "main");
  const request = transport.emit.mock.calls[0][2];
  transport.emit.mockClear();
  receive.mockClear();
  const handle = transport.handlers.get(`main:${event}`)!;
  await handle({ payload: { ...request, operation: { ...request.operation, cwd: "/other" } } });
  await handle({
    payload: { ...request, operation: { ...request.operation, sessionId: "other" } },
  });
  expect(transport.emit).not.toHaveBeenCalled();
  await handle({
    payload: { ...request, image: { ...image, frame: { ...image.frame, base64: "YWJj" } } },
  });
  expect(receive).not.toHaveBeenCalled();
  expect(transport.emit).toHaveBeenCalledWith(
    "tools-window",
    `${event}-ack`,
    expect.objectContaining({
      operation: request.operation,
      result: "conflict",
    }),
  );
});

it("cleans late listeners without sending after an unacknowledged timeout", async () => {
  vi.useFakeTimers();
  (window as any).__TAURI_INTERNALS__ = {};
  transport.label = "tools-window";
  let finish!: () => void;
  transport.delayedListen = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const result = attachDeviceImageAcrossWindows("/project", "missing", image, "main");
  const rejected = expect(result).rejects.toThrow("Open the originating conversation");
  await vi.waitFor(() => expect(transport.listenStarted).toBeGreaterThan(0));
  await vi.advanceTimersByTimeAsync(2500);
  await rejected;
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(transport.emit).not.toHaveBeenCalled();
  expect(transport.handlers.has(`tools-window:${event}-ack`)).toBe(false);
});

async function windows(receive: (file: Attachment, context: string) => boolean) {
  (window as any).__TAURI_INTERNALS__ = {};
  transport.label = "main";
  vi.resetModules();
  const main = await import("./deviceImageComposer");
  const stop = main.registerDeviceImageComposer("/project", "session", receive);
  stops.push(stop);
  await vi.waitFor(() => expect(transport.handlers.has(`main:${event}`)).toBe(true));
  vi.resetModules();
  const detached = await import("./deviceImageComposer");
  transport.label = "tools-window";
  return { main, detached, stop };
}

it("recovers a lost acknowledgement using the immutable receipt without attaching twice", async () => {
  const receive = vi.fn(() => true);
  const { detached, main, stop } = await windows(receive);
  vi.useFakeTimers();
  transport.dropAck = true;
  const delivery = detached
    .attachDeviceImageAcrossWindows("/project", "session", image, "main")
    .catch((error) => error);
  await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce());
  const original = transport.emit.mock.calls.find((call) => call[1] === event)![2];
  const lateAck = transport.handlers.get(`tools-window:${event}-ack`)!;
  await vi.advanceTimersByTimeAsync(2500);
  const error = await delivery;
  expect(error).toBeInstanceOf(detached.DeviceImageDraftDeliveryUncertainError);
  expect(error.operation).toEqual(original.operation);
  expect(JSON.stringify(error.operation)).not.toContain(image.frame.base64);
  expect(transport.handlers.has(`tools-window:${event}-ack`)).toBe(false);
  // An acknowledgement already queued before cleanup cannot change the settled result.
  await lateAck({ payload: { ...original, result: "accepted" } });
  transport.dropAck = false;
  await detached.attachDeviceImageAcrossWindows(
    "/project",
    "session",
    image,
    "main",
    error.operation,
  );
  const retry = transport.emit.mock.calls.filter((call) => call[1] === event).at(-1)![2];
  expect(retry.operation).toEqual(original.operation);
  expect(retry.mode).toBe("receipt");
  expect(retry.image).toBeUndefined();
  expect(receive).toHaveBeenCalledOnce();

  // Receipt survives composer unmount/remount and redocking into its original window.
  stop();
  await Promise.resolve();
  transport.label = "main";
  stops.push(main.registerDeviceImageComposer("/project", "session", receive));
  await main.reconcileDeviceImageTransfer(structuredClone(error.operation));
  expect(receive).toHaveBeenCalledOnce();
});

it("does not resend after an unknown outcome or when the receiving window has no receipt", async () => {
  const receive = vi.fn(() => {
    throw new Error("draft changed before failure");
  });
  const { detached } = await windows(receive);
  const error = await detached
    .attachDeviceImageAcrossWindows("/project", "session", image, "main")
    .catch((cause) => cause);
  expect(error).toBeInstanceOf(detached.DeviceImageDraftDeliveryUncertainError);
  await expect(
    detached.attachDeviceImageAcrossWindows("/project", "session", image, "main"),
  ).rejects.toBeInstanceOf(detached.DeviceImageDraftDeliveryUncertainError);
  expect(receive).toHaveBeenCalledOnce();
  const requestCount = transport.emit.mock.calls.filter((call) => call[1] === event).length;
  // Simulate a destination process reload: registered composer, missing in-memory receipt.
  vi.resetModules();
  const reloaded = await import("./deviceImageComposer");
  transport.label = "main";
  stops.push(reloaded.registerDeviceImageComposer("/project", "session", receive));
  await vi.waitFor(() => expect(transport.listenStarted).toBeGreaterThanOrEqual(4));
  transport.label = "tools-window-new";
  await expect(detached.reconcileDeviceImageTransfer(error.operation)).rejects.toBeInstanceOf(
    detached.DeviceImageDraftDeliveryUncertainError,
  );
  const request = transport.emit.mock.calls.filter((call) => call[1] === event).at(-1)![2];
  expect(request.mode).toBe("receipt");
  expect(request.replyTo).toBe("tools-window-new");
  expect(request.image).toBeUndefined();
  expect(transport.emit.mock.calls.filter((call) => call[1] === event)).toHaveLength(
    requestCount + 1,
  );
  expect(receive).toHaveBeenCalledOnce();
});

it("refuses changed image, machine, conversation and destination for an uncertain operation", async () => {
  const receive = vi.fn(() => {
    throw new Error("unknown mutation");
  });
  const { detached } = await windows(receive);
  const error = await detached
    .attachDeviceImageAcrossWindows("/project", "session", image, "main")
    .catch((cause) => cause);
  const requests = transport.emit.mock.calls.length;
  for (const [cwd, sessionId, value, destination] of [
    ["/other", "session", image, "main"],
    ["/project", "other", image, "main"],
    ["/project", "session", image, "other"],
    ["/project", "session", { ...image, comment: "edited" }, "main"],
    [
      "/project",
      "session",
      {
        ...image,
        computer: { ...image.computer, target: { kind: "machine", machineId: "other" } },
      },
      "main",
    ],
    [
      "/project",
      "session",
      { ...image, frame: { ...image.frame, capturedAt: "2026-10-27T10:00:00Z" } },
      "main",
    ],
  ] as const) {
    await expect(
      detached.attachDeviceImageAcrossWindows(cwd, sessionId, value, destination, error.operation),
    ).rejects.toBeInstanceOf(detached.DeviceImageDraftChangedError);
  }
  await expect(
    detached.attachDeviceImageAcrossWindows(
      "/project",
      "session",
      { ...image, comment: "edited" },
      "main",
    ),
  ).rejects.toBeInstanceOf(detached.DeviceImageDraftChangedError);
  expect(transport.emit.mock.calls).toHaveLength(requests);
  expect(receive).toHaveBeenCalledOnce();
});

it("reports definitive denial separately and permits a fresh explicit attempt after refusal", async () => {
  const receive = vi.fn(() => false);
  const { detached } = await windows(receive);
  await expect(
    detached.attachDeviceImageAcrossWindows("/project", "session", image, "main"),
  ).rejects.toBeInstanceOf(detached.DeviceImageDraftRejectedError);
  receive.mockReturnValue(true);
  await detached.attachDeviceImageAcrossWindows("/project", "session", image, "main");
  const requests = transport.emit.mock.calls.filter((call) => call[1] === event);
  expect(requests[0][2].operation.id).not.toBe(requests[1][2].operation.id);
  expect(receive).toHaveBeenCalledTimes(2);
});

it("ignores acknowledgements bound to another source, destination, payload or attempt", async () => {
  const { detached } = await windows(() => true);
  transport.handlers.delete(`main:${event}`);
  vi.useFakeTimers();
  const delivery = detached
    .attachDeviceImageAcrossWindows("/project", "session", image, "main")
    .catch((error) => error);
  await vi.waitFor(() => expect(transport.emit).toHaveBeenCalled());
  const request = transport.emit.mock.calls[0][2];
  const ack = transport.handlers.get(`tools-window:${event}-ack`)!;
  for (const changed of [
    { sourceWindow: "wrong" },
    { destinationWindow: "wrong" },
    { fingerprint: "b".repeat(64) },
    { sessionId: "other" },
    { cwd: "/other" },
  ])
    await ack({
      payload: { ...request, operation: { ...request.operation, ...changed }, result: "accepted" },
    });
  await ack({ payload: { ...request, attemptId: "old", result: "accepted" } });
  await ack({ payload: { ...request, replyTo: "other", result: "accepted" } });
  await vi.advanceTimersByTimeAsync(2500);
  expect(await delivery).toBeInstanceOf(detached.DeviceImageDraftDeliveryUncertainError);
  expect(transport.handlers.has(`tools-window:${event}-ack`)).toBe(false);
});
