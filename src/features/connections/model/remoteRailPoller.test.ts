import { afterEach, expect, it, vi } from "vitest";
import { RAIL_POLL_CONCURRENCY, startRailPoller } from "./remoteRailPoller";
import type { HostSessionSummary } from "./protocol";

afterEach(() => vi.useRealTimers());

const list = (status: "idle" | "running" = "idle") =>
  [{ id: "s", title: "S", status }] as HostSessionSummary[];

it("publishes a healthy target without waiting for a slow one", async () => {
  vi.useFakeTimers();
  const onResult = vi.fn();
  const stop = startRailPoller({
    targets: ["fast", "slow"],
    load: (target) => (target === "fast" ? Promise.resolve(list()) : new Promise(() => undefined)),
    onResult,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(onResult).toHaveBeenCalledTimes(1);
  expect(onResult.mock.calls[0][0]).toBe("fast");
  stop();
});

it("backs off a failing target by its own failures while a healthy one keeps its cadence", async () => {
  vi.useFakeTimers();
  const calls: Record<string, number> = { ok: 0, down: 0 };
  const stop = startRailPoller({
    targets: ["ok", "down"],
    load: async (target) => {
      calls[target]++;
      if (target === "down") throw new Error("unreachable");
      return list();
    },
    onResult: () => undefined,
    random: () => 0.5, // no jitter
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(calls).toEqual({ ok: 1, down: 1 });
  // down: retried after 6 s, then 12 s; ok: every 5 s.
  await vi.advanceTimersByTimeAsync(6_000);
  expect(calls.down).toBe(2);
  await vi.advanceTimersByTimeAsync(11_999);
  expect(calls.down).toBe(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls.down).toBe(3);
  expect(calls.ok).toBe(4);
  stop();
});

it("polls a target running a session faster, and a recovered target resets its backoff", async () => {
  vi.useFakeTimers();
  let down = true;
  let calls = 0;
  const stop = startRailPoller({
    targets: ["a"],
    load: async () => {
      calls++;
      if (down) throw new Error("x");
      return list("running");
    },
    onResult: () => undefined,
    random: () => 0.5,
  });
  await vi.advanceTimersByTimeAsync(0);
  down = false;
  await vi.advanceTimersByTimeAsync(6_000);
  expect(calls).toBe(2);
  await vi.advanceTimersByTimeAsync(4_000);
  expect(calls).toBe(3);
  stop();
});

it("never has more than the concurrency limit in flight and stops cleanly", async () => {
  vi.useFakeTimers();
  let inFlight = 0;
  let peak = 0;
  const releases: (() => void)[] = [];
  const stop = startRailPoller({
    targets: Array.from({ length: 10 }, (_, i) => i),
    load: () =>
      new Promise((resolve) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        releases.push(() => {
          inFlight--;
          resolve(list());
        });
      }),
    onResult: () => undefined,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(peak).toBe(RAIL_POLL_CONCURRENCY);
  while (releases.length) {
    releases.shift()!();
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(peak).toBe(RAIL_POLL_CONCURRENCY);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});
