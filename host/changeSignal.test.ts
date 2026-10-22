import { afterEach, expect, it, vi } from "vitest";
import { ChangeSignal } from "./changeSignal";
import { RemoteChanges } from "./remoteChanges";

afterEach(() => vi.useRealTimers());

it("coalesces wakes, closes the read/subscribe race and removes deadline timers", async () => {
  vi.useFakeTimers();
  const signal = new ChangeSignal();
  const version = signal.version;
  const first = signal.wait(Date.now() + 10000, () => false);
  signal.notify();
  signal.notify();
  await signal.wait(Date.now() + 10000, () => false, version);
  await first;
  expect(vi.getTimerCount()).toBe(0);
  const safety = signal.wait(Date.now() + 10000, () => false);
  await vi.advanceTimersByTimeAsync(1000);
  await safety;
  expect(vi.getTimerCount()).toBe(0);
});

it("wakes metadata readers on notify without waiting for their revision cache", async () => {
  const signal = new ChangeSignal();
  const changes = new RemoteChanges(signal);
  let revision = 1;
  const pending = changes.read(
    {
      instanceId: changes.instanceId,
      sessions: [{ sessionId: "s", revision }],
      projects: [],
      waitMs: 5000,
    },
    () => revision,
    async () => ({ etag: "", sessions: [] }),
  );
  await Promise.resolve();
  revision = 2;
  const start = performance.now();
  signal.notify();
  expect((await pending).sessions).toEqual([{ sessionId: "s", revision: 2 }]);
  expect(performance.now() - start).toBeLessThan(100);
});

it("idle readers only recheck at the safety tick and release cancelled capacity", async () => {
  vi.useFakeTimers();
  const changes = new RemoteChanges();
  const read = vi.fn(() => 1);
  let cancelled = false;
  const pending = changes.read(
    {
      instanceId: changes.instanceId,
      sessions: [{ sessionId: "s", revision: 1 }],
      projects: [],
      waitMs: 10000,
    },
    read,
    async () => ({ etag: "", sessions: [] }),
    () => cancelled,
  );
  await vi.advanceTimersByTimeAsync(999);
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(read).toHaveBeenCalledTimes(2);
  cancelled = true;
  await vi.advanceTimersByTimeAsync(1000);
  await pending;
  expect(vi.getTimerCount()).toBe(0);
});
