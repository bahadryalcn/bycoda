import { afterEach, expect, it, vi } from "vitest";
import { waitForProfileUnlock } from "./profile-unlock";
afterEach(() => vi.useRealTimers());

it("backs off a stale lock while preserving the original held result and reacts to real unlock", async () => {
  vi.useFakeTimers();
  let changed!: () => void;
  let locked = true,
    completed = false;
  const probe = vi.fn(async () => locked),
    close = vi.fn();
  const pending = waitForProfileUnlock({
    inUse: probe,
    observe: (listener) => {
      changed = listener;
      return close;
    },
  });
  void pending.then(
    () => {
      completed = true;
    },
    () => {},
  );
  await vi.advanceTimersByTimeAsync(300_000);
  expect(completed).toBe(false);
  expect(probe.mock.calls.length).toBeLessThanOrEqual(16);
  expect(close).not.toHaveBeenCalled();
  locked = false;
  changed();
  await pending;
  expect(close).toHaveBeenCalledOnce();
  const calls = probe.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(probe).toHaveBeenCalledTimes(calls);
});

it("coalesces a lock event burst while the original filesystem probe remains unresolved", async () => {
  vi.useFakeTimers();
  let changed!: () => void, release!: (value: boolean) => void;
  const held = new Promise<boolean>((resolve) => {
    release = resolve;
  });
  const probe = vi
    .fn()
    .mockImplementationOnce(() => held)
    .mockResolvedValue(false);
  const pending = waitForProfileUnlock({
    inUse: probe,
    observe: (listener) => {
      changed = listener;
      return () => {};
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  for (let index = 0; index < 1000; index++) changed();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(probe).toHaveBeenCalledOnce();
  release(true);
  await pending;
  expect(probe).toHaveBeenCalledTimes(2);
});

it("retains failed observations and never substitutes lock absence for the original live launcher", async () => {
  vi.useFakeTimers();
  let exit!: () => void;
  const exited = new Promise<void>((resolve) => {
    exit = resolve;
  });
  const probe = vi.fn().mockRejectedValueOnce(new Error("unknown lock")).mockResolvedValue(false);
  const pending = waitForProfileUnlock(
    {
      inUse: probe,
      observe: () => {
        throw new Error("watch unavailable");
      },
    },
    exited,
  );
  await vi.advanceTimersByTimeAsync(60_000);
  expect(probe).not.toHaveBeenCalled();
  exit();
  await vi.advanceTimersByTimeAsync(1001);
  await pending;
  expect(probe).toHaveBeenCalledTimes(2);
});
