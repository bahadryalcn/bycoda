import { afterEach, expect, it, vi } from "vitest";
import { TimeoutError, withTimeout } from "./withTimeout";

afterEach(() => vi.useRealTimers());

it("resolves and rejects with the wrapped promise before the deadline", async () => {
  await expect(withTimeout(Promise.resolve(1), 50, "ok")).resolves.toBe(1);
  await expect(withTimeout(Promise.reject(new Error("boom")), 50, "bad")).rejects.toThrow("boom");
});

it("rejects with TimeoutError when the promise never settles", async () => {
  vi.useFakeTimers();
  const pending = withTimeout(new Promise<never>(() => {}), 100, "read");
  const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
  await vi.advanceTimersByTimeAsync(100);
  await assertion;
});
