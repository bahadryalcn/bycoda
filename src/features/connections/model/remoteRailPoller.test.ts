import { afterEach, expect, it, vi } from "vitest";
import { RAIL_POLL_CONCURRENCY, startRailPoller } from "./remoteRailPoller";
import type { HostSessionSummary } from "./protocol";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const list = (status: "idle" | "running" = "idle") =>
  [{ id: "s", title: "S", status }] as HostSessionSummary[];

it("slows hidden fallback reads and wakes immediately online without overlapping reads", async () => {
  vi.useFakeTimers();
  const doc = Object.assign(new EventTarget(), { hidden: true });
  const win = new EventTarget();
  const network = { onLine: true };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", network);
  const load = vi.fn(async () => list());
  const stop = startRailPoller({ targets: ["a"], load, onResult: vi.fn() });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(load).toHaveBeenCalledTimes(3);
  network.onLine = false;
  win.dispatchEvent(new Event("offline"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(load).toHaveBeenCalledTimes(3);
  doc.hidden = false;
  network.onLine = true;
  win.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(4);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("coalesces repeated focus wakes behind one in-flight read and removes wake listeners on stop", async () => {
  vi.useFakeTimers();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const win = new EventTarget();
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { onLine: true });
  const releases: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  const load = vi.fn(
    () =>
      new Promise<HostSessionSummary[]>((resolve) => {
        active++;
        peak = Math.max(peak, active);
        releases.push(() => {
          active--;
          resolve(list());
        });
      }),
  );
  const stop = startRailPoller({ targets: ["a"], load, onResult: vi.fn(), foregroundMs: 3000 });
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 4; i++) win.dispatchEvent(new Event("focus"));
  expect(load).toHaveBeenCalledTimes(1);
  releases.shift()!();
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenLastCalledWith("a", true);
  expect(peak).toBe(1);
  stop();
  releases.shift()!();
  await vi.advanceTimersByTimeAsync(0);
  win.dispatchEvent(new Event("focus"));
  expect(load).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

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
