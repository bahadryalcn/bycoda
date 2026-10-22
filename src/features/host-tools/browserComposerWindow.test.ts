// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  attachBrowserSelection,
  attachBrowserSelectionAcrossWindows,
  MAX_BROWSER_SCREENSHOT_BYTES,
  registerBrowserComposer,
} from "./browserComposer";
import type { BrowserAnnotationCapture } from "../../shared/lib/browserAnnotation";
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
const capture: BrowserAnnotationCapture = {
  id: "selection",
  projectId: "project",
  sessionId: "host-session",
  navigationId: "page",
  capturedAt: "now",
  pageUrl: "http://localhost:3000/",
  viewport: { width: 1280, height: 720, scrollX: 0, scrollY: 0 },
  devicePixelRatio: 1,
  element: {
    tag: "button",
    text: "Save",
    selector: "button",
    path: "body > button",
    bounds: { x: 10, y: 20, width: 100, height: 40 },
    center: { x: 60, y: 40 },
    ancestry: [],
    computedStyle: {},
  },
  trust: "untrusted-page-data",
  limitations: [],
  screenshot: { data: "YWJj", mimeType: "image/jpeg", width: 1280, height: 720 },
};
const event = "bycoda:browser-selection-draft";
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

it("preserves local synchronous draft delivery and bounds screenshot metadata", () => {
  const receive = vi.fn((_attachment: Attachment) => true);
  stops.push(registerBrowserComposer("/project", "composer-session", receive));
  attachBrowserSelection("/project", "composer-session", "host-session", capture, "a".repeat(5000));
  expect(receive).toHaveBeenCalledOnce();
  expect(receive.mock.calls[0][0]).toMatchObject({
    size: 3,
    browserAnnotation: {
      sessionId: "host-session",
      comment: "a".repeat(4000),
      trust: "untrusted-page-data",
    },
  });
  expect(() =>
    attachBrowserSelection("/project", "composer-session", "other", capture, ""),
  ).toThrow("another conversation");
});

it("delivers a detached selection only to the originating composer and waits for its acknowledgement", async () => {
  (window as any).__TAURI_INTERNALS__ = {};
  const receive = vi.fn((_attachment: Attachment) => true);
  stops.push(registerBrowserComposer("/project", "composer-session", receive));
  await vi.waitFor(() => expect(transport.handlers.has(`main:${event}`)).toBe(true));
  vi.resetModules();
  const detached = await import("./browserComposer");
  transport.label = "tools-window";
  await detached.attachBrowserSelectionAcrossWindows(
    "/project",
    "composer-session",
    "host-session",
    capture,
    "Discuss this button",
    "main",
  );
  expect(receive).toHaveBeenCalledOnce();
  expect(receive.mock.calls[0][0]).toMatchObject({
    data: "YWJj",
    browserAnnotation: {
      sessionId: "host-session",
      comment: "Discuss this button",
      trust: "untrusted-page-data",
    },
  });
  expect(transport.emit.mock.calls[0]).toEqual([
    "main",
    event,
    expect.objectContaining({
      cwd: "/project",
      sessionId: "composer-session",
      hostSessionId: "host-session",
      replyTo: "tools-window",
    }),
  ]);
  expect(transport.handlers.has(`tools-window:${event}-ack`)).toBe(false);
});

it("rejects incorrect scope, trust and oversized screenshots at the receiving boundary", async () => {
  (window as any).__TAURI_INTERNALS__ = {};
  const receive = vi.fn(() => true);
  stops.push(registerBrowserComposer("/project", "composer-session", receive));
  await vi.waitFor(() => expect(transport.handlers.has(`main:${event}`)).toBe(true));
  const payload = {
    id: "request",
    cwd: "/project",
    sessionId: "composer-session",
    hostSessionId: "host-session",
    capture,
    comment: "",
    replyTo: "tools-window",
  };
  const handle = transport.handlers.get(`main:${event}`)!;
  await handle({ payload: { ...payload, cwd: "/other" } });
  await handle({ payload: { ...payload, sessionId: "other-composer" } });
  expect(transport.emit).not.toHaveBeenCalled();
  await handle({ payload: { ...payload, hostSessionId: "other-host" } });
  await handle({ payload: { ...payload, capture: { ...capture, trust: "trusted" } } });
  await handle({
    payload: {
      ...payload,
      capture: {
        ...capture,
        screenshot: {
          ...capture.screenshot,
          data: "Y".repeat(Math.ceil(MAX_BROWSER_SCREENSHOT_BYTES / 3) * 4 + 4),
        },
      },
    },
  });
  expect(receive).not.toHaveBeenCalled();
  expect(transport.emit).toHaveBeenCalledTimes(3);
  expect(transport.emit.mock.calls.every((call) => call[2].accepted === false)).toBe(true);
});

it("rejects invalid outgoing captures before contacting another window", async () => {
  await expect(
    attachBrowserSelectionAcrossWindows("/project", "missing", "other", capture, "", "main"),
  ).rejects.toThrow("another conversation");
  await expect(
    attachBrowserSelectionAcrossWindows(
      "/project",
      "missing",
      "host-session",
      {
        ...capture,
        screenshot: { ...capture.screenshot, width: Number.NaN },
      },
      "",
      "main",
    ),
  ).rejects.toThrow("Invalid browser screenshot");
  expect(transport.emit).not.toHaveBeenCalled();
});

it("ignores mismatched acknowledgements and cleans up when the composer does not reply", async () => {
  vi.useFakeTimers();
  transport.label = "tools-window";
  const promise = attachBrowserSelectionAcrossWindows(
    "/project",
    "missing",
    "host-session",
    capture,
    "",
    "closed-window",
  );
  const rejected = expect(promise).rejects.toThrow("Open the target conversation");
  await vi.advanceTimersByTimeAsync(0);
  transport.handlers.get(`tools-window:${event}-ack`)!({
    payload: { id: "another-request", accepted: true },
  });
  await vi.advanceTimersByTimeAsync(2500);
  await rejected;
  expect(transport.handlers.has(`tools-window:${event}-ack`)).toBe(false);
});

it("removes a reply listener that finishes registering after its request timed out", async () => {
  vi.useFakeTimers();
  transport.label = "tools-window";
  let finish!: () => void;
  transport.delayedListen = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const promise = attachBrowserSelectionAcrossWindows(
    "/project",
    "missing",
    "host-session",
    capture,
    "",
    "main",
  );
  const rejected = expect(promise).rejects.toThrow("Open the target conversation");
  await vi.advanceTimersByTimeAsync(2500);
  await rejected;
  finish();
  await vi.advanceTimersByTimeAsync(0);
  expect(transport.handlers.has(`tools-window:${event}-ack`)).toBe(false);
  expect(transport.emit).not.toHaveBeenCalled();
});
