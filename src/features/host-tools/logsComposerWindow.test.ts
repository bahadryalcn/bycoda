// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import {
  attachLogsToComposerAcrossWindows,
  MAX_LOG_DRAFT_CHARACTERS,
  registerLogsComposer,
} from "./logsComposer";

const transport = vi.hoisted(() => ({
  label: "main",
  handlers: new Map<string, (event: { payload: any }) => void>(),
  emit: vi.fn(),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => {
    const label = transport.label;
    return {
      label,
      listen: async (event: string, handler: (event: { payload: any }) => void) => {
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
    transport.handlers.get(`${label}:${event}`)?.({ payload });
  },
}));
afterEach(() => {
  transport.handlers.clear();
  transport.emit.mockClear();
  transport.label = "main";
  vi.useRealTimers();
  delete (window as any).__TAURI_INTERNALS__;
});

it("delivers an explicit bounded log draft to the originating window and waits for its acknowledgement", async () => {
  (window as any).__TAURI_INTERNALS__ = {};
  const receive = vi.fn(() => true);
  const stop = registerLogsComposer("/one", "session", receive);
  await vi.waitFor(() => expect(transport.handlers.has("main:bycoda:logs-draft")).toBe(true));
  // The actual detached window has a separate module cache. Simulate that boundary
  // with an isolated import while keeping the same native event transport.
  vi.resetModules();
  const detached = await import("./logsComposer");
  transport.label = "logs-window";
  try {
    await detached.attachLogsToComposerAcrossWindows(
      "/one",
      "session",
      "Untrusted log: failed fetch",
      "main",
    );
    expect(receive).toHaveBeenCalledExactlyOnceWith("Untrusted log: failed fetch");
    expect(transport.emit.mock.calls[0]).toEqual([
      "main",
      "bycoda:logs-draft",
      expect.objectContaining({ cwd: "/one", sessionId: "session", replyTo: "logs-window" }),
    ]);
    expect(transport.handlers.has("logs-window:bycoda:logs-draft-ack")).toBe(false);
  } finally {
    stop();
  }
});

it("rejects oversized selections without contacting another window", async () => {
  await expect(
    attachLogsToComposerAcrossWindows(
      "/one",
      "missing",
      "x".repeat(MAX_LOG_DRAFT_CHARACTERS + 1),
      "main",
    ),
  ).rejects.toThrow("smaller");
  expect(transport.emit).not.toHaveBeenCalled();
});

it("times out when the originating composer is closed and removes its reply listener", async () => {
  vi.useFakeTimers();
  transport.label = "logs-window";
  const result = attachLogsToComposerAcrossWindows("/one", "missing", "Log entry", "closed-window");
  const rejected = expect(result).rejects.toThrow("Open the target conversation");
  await vi.advanceTimersByTimeAsync(2500);
  await rejected;
  expect(transport.handlers.has("logs-window:bycoda:logs-draft-ack")).toBe(false);
});
