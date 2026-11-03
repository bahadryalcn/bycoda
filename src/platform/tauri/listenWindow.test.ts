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
    expect(mocks.listen).toHaveBeenCalledWith("menu:new_tab", handler, { target: "window-7" });
    await Promise.resolve();
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
    await Promise.resolve();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("falls back to an unscoped listener outside a webview", () => {
    mocks.label = null;
    mocks.listen.mockResolvedValue(() => {});
    const handler = vi.fn();
    listenWindow("x", handler);
    expect(mocks.listen).toHaveBeenCalledWith("x", handler);
  });

  it("scopes once() and the async form the same way", async () => {
    mocks.once.mockResolvedValue(() => {});
    mocks.listen.mockResolvedValue(() => {});
    const handler = vi.fn();
    onceWindow("ready", handler);
    expect(mocks.once).toHaveBeenCalledWith("ready", handler, { target: "window-7" });
    await listenWindowAsync("state", handler);
    expect(mocks.listen).toHaveBeenCalledWith("state", handler, { target: "window-7" });
  });
});
