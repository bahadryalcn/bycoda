import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("./platform", () => ({ IS_MAC: true }));
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); mocks.invoke.mockResolvedValue(undefined); });
describe("native image pinch claims", () => {
  it("shares one subscription, restores the previous scope and ignores released callbacks", async () => {
    const stops = [vi.fn(), vi.fn()]; const callbacks: ((event: { payload: number }) => void)[] = [];
    mocks.listen.mockImplementation(async (_name, callback) => { callbacks.push(callback); return stops[callbacks.length - 1]; });
    const { claimTrackpadMagnify } = await import("./trackpadZoom");
    const first = vi.fn(), second = vi.fn(); const releaseFirst = claimTrackpadMagnify(first), releaseSecond = claimTrackpadMagnify(second);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("set_trackpad_zoom_enabled", { enabled: true }));
    callbacks[0]({ payload: .2 }); expect(second).toHaveBeenCalledWith(.2); expect(first).not.toHaveBeenCalled();
    releaseSecond(); callbacks[0]({ payload: .3 }); expect(first).toHaveBeenCalledWith(.3);
    releaseFirst(); await vi.waitFor(() => expect(stops[0]).toHaveBeenCalledOnce());
    const newer = vi.fn(), releaseNewer = claimTrackpadMagnify(newer);
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledTimes(2));
    callbacks[0]({ payload: 1 }); expect(newer).not.toHaveBeenCalled();
    releaseNewer(); await vi.waitFor(() => expect(stops[1]).toHaveBeenCalledOnce());
  });
  it("cleans up even when the surface closes before setup resolves", async () => {
    let resolve!: (stop: () => void) => void; const stop = vi.fn();
    mocks.listen.mockReturnValue(new Promise(done => { resolve = done; }));
    const { claimTrackpadMagnify } = await import("./trackpadZoom"); const release = claimTrackpadMagnify(vi.fn());
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalledOnce()); release(); resolve(stop);
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(mocks.invoke).toHaveBeenLastCalledWith("set_trackpad_zoom_enabled", { enabled: false });
  });
  it("releases a listener and attempts native cleanup after an enable failure", async () => {
    const stop = vi.fn(); const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.listen.mockResolvedValue(stop); mocks.invoke.mockRejectedValueOnce(new Error("setup failed"));
    const { claimTrackpadMagnify } = await import("./trackpadZoom"); const release = claimTrackpadMagnify(vi.fn());
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());
    expect(mocks.invoke).toHaveBeenCalledWith("set_trackpad_zoom_enabled", { enabled: false });
    release(); warning.mockRestore();
  });
});
