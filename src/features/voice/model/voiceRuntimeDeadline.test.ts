import { afterEach, expect, it, vi } from "vitest";
import { setVoiceApprovalPort, voiceRuntimeDeadline } from "./voiceRuntimeDeadline";

afterEach(() => {
  vi.useRealTimers();
  setVoiceApprovalPort(undefined);
});

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

function approvalPort() {
  const listeners = new Set<() => void>();
  const state = { pending: false };
  setVoiceApprovalPort({
    pending: () => state.pending,
    subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
  });
  return {
    listeners,
    set(pending: boolean) {
      state.pending = pending;
      listeners.forEach((listener) => listener());
    },
  };
}

it("suspends the deadline while an owner approval is pending and restarts a full window after", async () => {
  vi.useFakeTimers();
  const port = approvalPort();
  let resolve!: (value: string) => void;
  port.set(true);
  const result = voiceRuntimeDeadline(
    () => new Promise<string>((done) => (resolve = done)),
    new AbortController().signal,
    100,
  );
  let outcome = "";
  void result.then(
    (value) => (outcome = value),
    (error: Error) => (outcome = error.message),
  );
  await vi.advanceTimersByTimeAsync(500);
  expect(outcome).toBe("");
  port.set(false);
  await vi.advanceTimersByTimeAsync(99);
  expect(outcome).toBe("");
  await vi.advanceTimersByTimeAsync(1);
  expect(outcome).toContain("outcome is unknown");
  expect(port.listeners.size).toBe(0);
  resolve("late");
});

it("still resolves normally when approvals appear and clear mid-operation", async () => {
  vi.useFakeTimers();
  const port = approvalPort();
  const result = voiceRuntimeDeadline(
    () => new Promise<string>((done) => setTimeout(() => done("ok"), 300)),
    new AbortController().signal,
    100,
  );
  const settled = expect(result).resolves.toBe("ok");
  port.set(true);
  await vi.advanceTimersByTimeAsync(300);
  await settled;
});
