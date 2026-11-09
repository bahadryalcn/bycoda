import { describe, expect, it, vi } from "vitest";
import { LiveViewRegistry, commandsFor, type ScreencastPort } from "./live-view";

type Listener = (method: string, params: any, sessionId?: string) => void;

function fakePort(sessionId = "cdp-1") {
  const listeners = new Set<Listener>();
  const sent: { method: string; params?: Record<string, unknown> }[] = [];
  const port: ScreencastPort = {
    sessionId,
    send: vi.fn(async (method: string, params?: Record<string, unknown>) => {
      sent.push({ method, params });
      return {};
    }) as ScreencastPort["send"],
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const emit = (method: string, params: unknown, id = sessionId) => {
    for (const listener of listeners) listener(method, params, id);
  };
  return { port, sent, emit, listeners };
}

const frameEvent = (data = "AAAA", width = 800, height = 600) => ({
  data,
  sessionId: 7,
  metadata: { deviceWidth: width, deviceHeight: height },
});

describe("LiveViewRegistry", () => {
  it("refuses frames for an account without a browser window", async () => {
    const registry = new LiveViewRegistry();
    await expect(registry.frame("acc")).rejects.toThrow("No browser window");
  });

  it("starts the screencast on first use, acknowledges every frame, and returns the latest accepted frame", async () => {
    let clock = 0;
    const registry = new LiveViewRegistry({
      now: () => clock,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    const { port, sent, emit } = fakePort();
    registry.attach("acc", port);
    expect(await registry.frame("acc")).toBeNull();
    expect(sent[0]).toEqual({
      method: "Page.startScreencast",
      params: expect.objectContaining({ format: "jpeg" }),
    });
    clock = 1000;
    emit("Page.screencastFrame", frameEvent("QUFB"));
    expect(sent.at(-1)).toEqual({ method: "Page.screencastFrameAck", params: { sessionId: 7 } });
    expect(await registry.frame("acc")).toEqual({ jpegBase64: "QUFB", width: 800, height: 600 });
  });

  it("drops frames above two per second and frames over one MiB", async () => {
    let clock = 0;
    const registry = new LiveViewRegistry({
      now: () => clock,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    const { port, emit } = fakePort();
    registry.attach("acc", port);
    await registry.frame("acc");
    clock = 1000;
    emit("Page.screencastFrame", frameEvent("first"));
    clock = 1200;
    emit("Page.screencastFrame", frameEvent("too-soon"));
    expect((await registry.frame("acc"))?.jpegBase64).toBe("first");
    clock = 2000;
    emit("Page.screencastFrame", frameEvent("x".repeat(1024 * 1024 * 2)));
    expect((await registry.frame("acc"))?.jpegBase64).toBe("first");
  });

  it("ignores frames from another CDP session", async () => {
    let clock = 1000;
    const registry = new LiveViewRegistry({
      now: () => clock,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    const { port, emit } = fakePort("cdp-1");
    registry.attach("acc", port);
    await registry.frame("acc");
    emit("Page.screencastFrame", frameEvent("other"), "cdp-2");
    expect(await registry.frame("acc")).toBeNull();
  });

  it("stops the screencast after idle time but never closes the browser", async () => {
    let clock = 0;
    let scheduled: (() => void) | undefined;
    const registry = new LiveViewRegistry({
      now: () => clock,
      idleStopMs: 10_000,
      setTimer: (callback) => {
        scheduled = callback;
        return callback;
      },
      clearTimer: () => undefined,
    });
    const { port, sent } = fakePort();
    const detach = registry.attach("acc", port);
    await registry.frame("acc");
    clock = 10_000;
    scheduled?.();
    await vi.waitFor(() => expect(sent.at(-1)?.method).toBe("Page.stopScreencast"));
    expect(sent.some((item) => item.method === "Browser.close")).toBe(false);
    detach();
    await expect(registry.frame("acc")).rejects.toThrow("No browser window");
  });
});

describe("commandsFor (owner input)", () => {
  const frame = { jpegBase64: "", width: 800, height: 600 };

  it("maps a click inside the frame to move, press and release", () => {
    const commands = commandsFor({ type: "click", x: 10, y: 20 }, frame);
    expect(commands.map((item) => item.params.type)).toEqual([
      "mouseMoved",
      "mousePressed",
      "mouseReleased",
    ]);
  });

  it("refuses clicks outside the frame, clicks before any frame, and invented events", () => {
    expect(() => commandsFor({ type: "click", x: 900, y: 1 }, frame)).toThrow("outside the page");
    expect(() => commandsFor({ type: "click", x: 1, y: 1 }, undefined)).toThrow("no frame");
    expect(() => commandsFor({ type: "eval", code: "1" }, frame)).toThrow("not supported");
  });

  it("accepts typed text up to 1000 characters without control characters", () => {
    expect(commandsFor({ type: "type", text: "hello" }, frame)).toEqual([
      { method: "Input.insertText", params: { text: "hello" } },
    ]);
    expect(() => commandsFor({ type: "type", text: "a\u0001b" }, frame)).toThrow("text is invalid");
    expect(() => commandsFor({ type: "type", text: "x".repeat(1001) }, frame)).toThrow(
      "text is invalid",
    );
  });

  it("allows only listed keys and bounded scrolling", () => {
    expect(commandsFor({ type: "key", key: "Enter" }, frame).length).toBe(2);
    expect(() => commandsFor({ type: "key", key: "Shift" }, frame)).toThrow("not allowed");
    expect(() => commandsFor({ type: "key", key: "constructor" }, frame)).toThrow("not allowed");
    expect(() => commandsFor({ type: "scroll", deltaY: 5000 }, frame)).toThrow("scroll is invalid");
  });
});
