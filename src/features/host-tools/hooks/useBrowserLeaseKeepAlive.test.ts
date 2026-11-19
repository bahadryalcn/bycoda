// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBrowserLeaseKeepAlive } from "./useBrowserLiveFrames";

let root: Root;
let host: HTMLDivElement;
let hidden = false;

type Probe = {
  enabled: boolean;
  expiresAt: number | undefined;
  renew: () => Promise<unknown>;
  onResult?: (failure: unknown) => void;
};

/** A local monotonic deadline `ms` from now, as `hostLifetimeDeadline` produces it. */
const lease = (ms: number) => performance.now() + ms;

function show(props: Probe) {
  function Component() {
    useBrowserLeaseKeepAlive(props.enabled, props.expiresAt, props.renew, props.onResult);
    return null;
  }
  act(() => root.render(createElement(Component)));
}
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // The lease is judged on the monotonic clock, so that clock must advance with the timers.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  hidden = false;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  Reflect.deleteProperty(document, "hidden");
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser lease keep-alive", () => {
  it("renews once shortly before the lease ends", async () => {
    const renew = vi.fn().mockResolvedValue(undefined);
    show({ enabled: true, expiresAt: lease(30_000), renew });
    await advance(19_000);
    expect(renew).not.toHaveBeenCalled();
    await advance(1000);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("retries a failed renewal every few seconds and reports each outcome", async () => {
    const renew = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const onResult = vi.fn();
    show({ enabled: true, expiresAt: lease(30_000), renew, onResult });
    await advance(20_000);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenLastCalledWith(expect.any(Error));
    await advance(3000);
    expect(renew).toHaveBeenCalledTimes(2);
    await advance(3000);
    expect(renew).toHaveBeenCalledTimes(3);
    expect(onResult).toHaveBeenLastCalledWith(undefined);
  });

  it("stops retrying once the original lease has expired and never renews after", async () => {
    const renew = vi.fn().mockRejectedValue(new Error("offline"));
    show({ enabled: true, expiresAt: lease(30_000), renew });
    await advance(40_000);
    const calls = renew.mock.calls.length;
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThanOrEqual(5);
    await advance(60_000);
    expect(renew).toHaveBeenCalledTimes(calls);
  });

  it("does not renew an already ended lease when coming back online or visible", async () => {
    const renew = vi.fn().mockResolvedValue(undefined);
    show({ enabled: true, expiresAt: lease(30_000), renew });
    await advance(31_000);
    renew.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(10_000);
    expect(renew).not.toHaveBeenCalled();
  });

  it("stops when control is revoked (hook disabled) or the lease is replaced", async () => {
    const renew = vi.fn().mockRejectedValue(new Error("offline"));
    const expiresAt = lease(30_000);
    show({ enabled: true, expiresAt, renew });
    await advance(20_000);
    expect(renew).toHaveBeenCalledTimes(1);
    show({ enabled: false, expiresAt, renew });
    await advance(20_000);
    expect(renew).toHaveBeenCalledTimes(1);
    show({ enabled: true, expiresAt: lease(80_000), renew });
    await advance(1000);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("renews immediately when the network returns inside the lease", async () => {
    const renew = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    show({ enabled: true, expiresAt: lease(30_000), renew });
    await advance(20_000);
    expect(renew).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it("defers a renewal that falls due while hidden until the panel is visible", async () => {
    const renew = vi.fn().mockResolvedValue(undefined);
    show({ enabled: true, expiresAt: lease(30_000), renew });
    hidden = true;
    await advance(25_000);
    expect(renew).not.toHaveBeenCalled();
    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("runs one renewal at a time", async () => {
    let finish: () => void = () => {};
    const renew = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    show({ enabled: true, expiresAt: lease(30_000), renew });
    await advance(20_000);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(renew).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it("ignores a skewed wall clock: a Date jump does not end or extend the lease", async () => {
    const renew = vi.fn().mockResolvedValue(undefined);
    show({ enabled: true, expiresAt: lease(30_000), renew });
    // The client clock runs 10 minutes fast; the monotonic lease window must not change.
    vi.setSystemTime(Date.now() + 600_000);
    await advance(19_000);
    expect(renew).not.toHaveBeenCalled();
    await advance(1000);
    expect(renew).toHaveBeenCalledTimes(1);
  });
});
