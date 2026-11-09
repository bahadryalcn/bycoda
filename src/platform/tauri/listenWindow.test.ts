import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  once: vi.fn(),
  label: "window-7" as string | null,
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen, once: mocks.once }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => {
    if (mocks.label === null) throw new Error("no window");
    return { label: mocks.label };
  },
}));

import { listenWindow, listenWindowAsync, onceWindow } from "./listenWindow";

describe("listenWindow", () => {
  beforeEach(() => {
    mocks.listen.mockReset();
    mocks.once.mockReset();
    mocks.label = "window-7";
  });

  it("targets the current window label", async () => {
    const release = vi.fn();
    mocks.listen.mockResolvedValue(release);
    const handler = vi.fn();
    const dispose = listenWindow("menu:new_tab", handler);
    expect(mocks.listen).toHaveBeenCalledWith("menu:new_tab", expect.any(Function), {
      target: "window-7",
    });
    await vi.waitFor(() => expect(mocks.listen).toHaveResolved());
    dispose();
    expect(release).toHaveBeenCalledTimes(1);
    dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases a registration that resolves after the subscriber disposed", async () => {
    const release = vi.fn();
    let resolve!: (value: () => void) => void;
    mocks.listen.mockReturnValue(new Promise<() => void>((done) => (resolve = done)));
    const dispose = listenWindow("quit_commit", () => {});
    dispose();
    resolve(release);
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });

  it("never registers globally when a window identity is unavailable", async () => {
    mocks.label = null;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn();
    const stop = listenWindow("x", handler);
    onceWindow("x", handler)();
    await expect(listenWindowAsync("x", handler)).rejects.toThrow("no window");
    stop();
    expect(mocks.listen).not.toHaveBeenCalled();
    expect(mocks.once).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });

  it("rejects an empty identity instead of widening its target", async () => {
    mocks.label = "";
    await expect(listenWindowAsync("x", vi.fn())).rejects.toThrow("requires a window identity");
    expect(mocks.listen).not.toHaveBeenCalled();
  });

  it("ignores events after disposal even before native registration settles", async () => {
    let resolve!: (release: () => void) => void;
    const release = vi.fn();
    mocks.listen.mockReturnValue(new Promise<() => void>((done) => (resolve = done)));
    const handler = vi.fn();
    const stop = listenWindow("late", handler);
    const receive = mocks.listen.mock.calls[0][1];
    receive({ payload: "before" });
    stop();
    receive({ payload: "after" });
    resolve(release);
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("scopes once() and the async form the same way", async () => {
    mocks.once.mockResolvedValue(() => {});
    mocks.listen.mockResolvedValue(() => {});
    const handler = vi.fn();
    onceWindow("ready", handler);
    expect(mocks.once).toHaveBeenCalledWith("ready", expect.any(Function), { target: "window-7" });
    await listenWindowAsync("state", handler);
    expect(mocks.listen).toHaveBeenCalledWith("state", expect.any(Function), {
      target: "window-7",
    });
  });

  it("the async disposer stops queued callbacks and releases once", async () => {
    const release = vi.fn();
    mocks.listen.mockResolvedValue(release);
    const handler = vi.fn();
    const stop = await listenWindowAsync("state", handler);
    const receive = mocks.listen.mock.calls[0][1];
    receive({ payload: "live" });
    stop();
    stop();
    receive({ payload: "queued after cleanup" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("a failed async registration cannot keep delivering callbacks", async () => {
    mocks.listen.mockRejectedValue(new Error("native registration failed"));
    const handler = vi.fn();
    await expect(listenWindowAsync("state", handler)).rejects.toThrow("native registration failed");
    mocks.listen.mock.calls[0][1]({ payload: "late" });
    expect(handler).not.toHaveBeenCalled();
  });
});
