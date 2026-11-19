// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFrameWithRetry, useBrowserLiveFrames } from "./useBrowserLiveFrames";

let root: Root;
let host: HTMLDivElement;
let hidden = false;

type Frame = { frameSequence?: number };
type Probe = {
  enabled: boolean;
  read: (after: number, beside: boolean) => Promise<Frame | undefined>;
  onError: (cause: unknown) => void;
};

function show(props: Probe) {
  function Component() {
    useBrowserLiveFrames({ ...props, idle: () => true });
    return null;
  }
  act(() => root.render(createElement(Component)));
}
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const timeout = () => new Error("browser.frame timed out");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

describe("browser live frames", () => {
  it("keeps polling after a transient read failure without surfacing an error", async () => {
    const read = vi
      .fn<Probe["read"]>()
      .mockResolvedValueOnce({ frameSequence: 1 })
      .mockRejectedValueOnce(timeout())
      .mockResolvedValue({ frameSequence: 2 });
    const onError = vi.fn();
    show({ enabled: true, read, onError });
    await advance(250);
    expect(read).toHaveBeenCalledTimes(1);
    await advance(30);
    expect(read).toHaveBeenCalledTimes(2);
    // The failed read is retried with the same sequence, after the first back-off.
    await advance(500);
    expect(read).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenLastCalledWith(1, true);
    await advance(100);
    expect(read).toHaveBeenLastCalledWith(2, true);
    expect(onError).not.toHaveBeenCalled();
  });

  it("backs off exponentially and reports the failure once after repeated failures", async () => {
    const failure = timeout();
    const read = vi.fn<Probe["read"]>().mockRejectedValue(failure);
    const onError = vi.fn();
    show({ enabled: true, read, onError });
    await advance(250);
    expect(read).toHaveBeenCalledTimes(1);
    await advance(499);
    expect(read).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(read).toHaveBeenCalledTimes(2);
    await advance(1000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
    await advance(2000);
    expect(read).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    // The loop has ended: nothing reads or reports again.
    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("counts only consecutive failures: a good frame resets the budget", async () => {
    const bad = () => Promise.reject(timeout());
    const read = vi
      .fn<Probe["read"]>()
      .mockImplementationOnce(bad)
      .mockImplementationOnce(bad)
      .mockImplementationOnce(bad)
      .mockResolvedValueOnce({ frameSequence: 1 })
      .mockImplementationOnce(bad)
      .mockImplementationOnce(bad)
      .mockImplementationOnce(bad)
      .mockResolvedValue({ frameSequence: 2 });
    const onError = vi.fn();
    show({ enabled: true, read, onError });
    await advance(20_000);
    expect(read.mock.calls.length).toBeGreaterThan(8);
    expect(onError).not.toHaveBeenCalled();
  });

  it("falls back to one read per second on a Host without frame sequences after a failure", async () => {
    const read = vi
      .fn<Probe["read"]>()
      .mockRejectedValueOnce(timeout())
      .mockResolvedValue({});
    const onError = vi.fn();
    show({ enabled: true, read, onError });
    await advance(250 + 500);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(0, false);
    await advance(1000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not read or report while the panel is hidden during a retry", async () => {
    const read = vi.fn<Probe["read"]>().mockRejectedValue(timeout());
    const onError = vi.fn();
    show({ enabled: true, read, onError });
    await advance(250);
    expect(read).toHaveBeenCalledTimes(1);
    hidden = true;
    await advance(30_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("stops retrying and stays silent once Live is turned off during back-off", async () => {
    const read = vi.fn<Probe["read"]>().mockRejectedValue(timeout());
    const onError = vi.fn();
    show({ enabled: true, read, onError });
    await advance(250);
    expect(read).toHaveBeenCalledTimes(1);
    show({ enabled: false, read, onError });
    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("ignores a read that fails after the loop was cancelled", async () => {
    let fail: (cause: unknown) => void = () => {};
    const read = vi.fn<Probe["read"]>(
      () => new Promise<Frame | undefined>((_, reject) => (fail = reject)),
    );
    const onError = vi.fn();
    show({ enabled: true, read, onError });
    await advance(250);
    show({ enabled: false, read, onError });
    await act(async () => fail(timeout()));
    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("single frame read with retry", () => {
  it("returns the first successful read without waiting", async () => {
    const read = vi.fn().mockResolvedValue("frame");
    await expect(readFrameWithRetry(read, () => false)).resolves.toBe("frame");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("retries with back-off and returns once a read succeeds", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(timeout())
      .mockRejectedValueOnce(timeout())
      .mockResolvedValue("frame");
    const result = readFrameWithRetry(read, () => false);
    await advance(499);
    expect(read).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(read).toHaveBeenCalledTimes(2);
    await advance(1000);
    await expect(result).resolves.toBe("frame");
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("throws the last failure after four reads", async () => {
    const failure = timeout();
    const read = vi.fn().mockRejectedValue(failure);
    const result = readFrameWithRetry(read, () => false).catch((cause) => cause);
    await advance(3500);
    await expect(result).resolves.toBe(failure);
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("does not retry once the caller is gone", async () => {
    const failure = timeout();
    const read = vi.fn().mockRejectedValue(failure);
    await expect(readFrameWithRetry(read, () => true)).rejects.toBe(failure);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
