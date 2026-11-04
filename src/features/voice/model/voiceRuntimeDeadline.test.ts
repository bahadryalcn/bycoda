import { afterEach, expect, it, vi } from "vitest";
import { voiceRuntimeDeadline } from "./voiceRuntimeDeadline";

afterEach(() => vi.useRealTimers());

it("bounds an unresolved effect and consumes a late rejection without retry", async () => {
  vi.useFakeTimers();
  let reject!: (error: Error) => void;
  const effect = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const result = voiceRuntimeDeadline(effect, new AbortController().signal, 100);
  const rejected = expect(result).rejects.toThrow("outcome is unknown");
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  reject(new Error("late"));
  await Promise.resolve();
  expect(effect).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("converts synchronous throws and aborts the wait without dispatching a cancelled operation", async () => {
  const controller = new AbortController();
  await expect(
    voiceRuntimeDeadline(() => {
      throw new Error("sync");
    }, controller.signal),
  ).rejects.toThrow("sync");
  controller.abort(new Error("stopped"));
  const effect = vi.fn(async () => "unexpected");
  await expect(voiceRuntimeDeadline(effect, controller.signal)).rejects.toThrow("stopped");
  expect(effect).not.toHaveBeenCalled();
});

it("releases a pending wait and timer on cancellation", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const result = voiceRuntimeDeadline(() => new Promise(() => {}), controller.signal);
  const rejected = expect(result).rejects.toThrow("stopped");
  controller.abort(new Error("stopped"));
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps an explicitly shown owner prompt pending past the application deadline", async () => {
  vi.useFakeTimers();
  let answer!: (value: string) => void;
  const result = voiceRuntimeDeadline(
    (wait) => {
      wait.waitForOwner();
      return new Promise<string>((resolve) => {
        answer = resolve;
      });
    },
    new AbortController().signal,
    100,
  );
  await vi.advanceTimersByTimeAsync(10_000);
  answer("owner answered");
  await expect(result).resolves.toBe("owner answered");
  expect(vi.getTimerCount()).toBe(0);
});

it("still aborts a human wait when its conversation closes", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const result = voiceRuntimeDeadline((wait) => {
    wait.waitForOwner();
    return new Promise(() => {});
  }, controller.signal);
  const rejected = expect(result).rejects.toThrow("closed");
  controller.abort(new Error("closed"));
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});
