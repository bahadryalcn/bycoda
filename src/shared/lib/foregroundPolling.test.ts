// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { startForegroundPolling } from "./foregroundPolling";

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("stops timers while hidden and refreshes once when visibility and focus return", async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const refresh = vi.fn();
  stop = startForegroundPolling(refresh, 1_000).stop;
  expect(refresh).toHaveBeenCalledOnce();
  hidden.mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(refresh).toHaveBeenCalledOnce();
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("backs off after inactivity and rearms once per period change", async () => {
  vi.useFakeTimers();
  const arm = vi.spyOn(globalThis, "setInterval");
  const refresh = vi.fn();
  const poll = startForegroundPolling(refresh, 10_000);
  stop = poll.stop;
  await vi.advanceTimersByTimeAsync(59_000);
  poll.setPeriod(10_000);
  expect(arm).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(arm).toHaveBeenLastCalledWith(expect.any(Function), 40_000);
  await vi.advanceTimersByTimeAsync(80_000);
  expect(arm).toHaveBeenCalledTimes(2);
  document.dispatchEvent(new Event("keydown"));
  expect(arm).toHaveBeenCalledTimes(3);
  expect(arm).toHaveBeenLastCalledWith(expect.any(Function), 10_000);
});
