import { afterEach, expect, it, vi } from "vitest";
import {
  RAIL_POLL_CONCURRENCY,
  RAIL_WAKE_RECHECK_MS,
  createSlotLimiter,
  startRailPoller,
} from "./remoteRailPoller";
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

it("ignores repeated focus wakes while a read is in flight and removes wake listeners on stop", async () => {
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
  expect(load).toHaveBeenCalledTimes(1);
  expect(peak).toBe(1);
  stop();
  await vi.advanceTimersByTimeAsync(0);
  win.dispatchEvent(new Event("focus"));
  expect(load).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

function railWindow(options: { hidden?: boolean } = {}) {
  const doc = Object.assign(new EventTarget(), { hidden: options.hidden ?? false });
  const win = new EventTarget();
  const network = { onLine: true };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", network);
  return { doc, win, network };
}

it("does not force a fresh read on focus for a target that settled recently, then does once it is old", async () => {
  vi.useFakeTimers();
  const { win } = railWindow();
  const load = vi.fn(async (_target: string, _force?: boolean) => list());
  const stop = startRailPoller({ targets: ["a"], load, onResult: vi.fn(), foregroundMs: 60_000 });
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 5; i++) win.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(RAIL_WAKE_RECHECK_MS);
  win.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenLastCalledWith("a", true);
  stop();
});

it("keeps the backoff of a failing target on focus but resets it when the network returns", async () => {
  vi.useFakeTimers();
  const { win } = railWindow();
  const load = vi.fn(async (_target: string, _force?: boolean): Promise<HostSessionSummary[]> => {
    throw new Error("unreachable");
  });
  const stop = startRailPoller({
    targets: ["down"],
    load,
    onResult: vi.fn(),
    onError: vi.fn(),
    random: () => 0.5,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  // Past the recheck window the failing target still ignores focus: its own backoff rules.
  await vi.advanceTimersByTimeAsync(RAIL_WAKE_RECHECK_MS - 1);
  const before = load.mock.calls.length;
  win.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(before);
  expect(load.mock.calls.every(([, force]) => force !== true)).toBe(true);
  win.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(before + 1);
  expect(load).toHaveBeenLastCalledWith("down", true);
  stop();
});

it("re-times a failing target's slow hidden retry when the window becomes visible", async () => {
  vi.useFakeTimers();
  const { doc } = railWindow({ hidden: true });
  const load = vi.fn(async (_target: string, _force?: boolean): Promise<HostSessionSummary[]> => {
    throw new Error("unreachable");
  });
  const stop = startRailPoller({
    targets: ["down"],
    load,
    onResult: vi.fn(),
    onError: vi.fn(),
    random: () => 0.5,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  // Hidden: the next retry waits the 30 s hidden cadence. Visible again: the 6 s foreground
  // backoff counted from the failed read applies, not a forced redial.
  await vi.advanceTimersByTimeAsync(2_000);
  doc.hidden = false;
  doc.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(3_999);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(2);
  expect(load).toHaveBeenLastCalledWith("down");
  stop();
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

it("times out a load that never settles so its slot frees and the target backs off", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", { onLine: true });
  const onError = vi.fn();
  const onResult = vi.fn();
  const load = vi.fn((target: string) =>
    target === "stuck" ? new Promise<HostSessionSummary[]>(() => {}) : Promise.resolve(list()),
  );
  const stop = startRailPoller({
    targets: ["stuck", "ok"],
    concurrency: 1,
    load,
    onResult,
    onError,
    loadTimeoutMs: 10_000,
    foregroundMs: 1_000,
    random: () => 0.5,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(onResult).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(onError).toHaveBeenCalledWith("stuck", expect.objectContaining({ name: "TimeoutError" }));
  expect(onResult).toHaveBeenCalledWith("ok", list());
  stop();
});

it("lets queued polls finish when stopped", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", { onLine: true });
  const load = vi.fn(() => new Promise<HostSessionSummary[]>(() => {}));
  const stop = startRailPoller({ targets: ["a", "b"], concurrency: 1, load, onResult: vi.fn() });
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(1);
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(load).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("runs at most the slot limit of limiter tasks in order and skips cancelled ones", async () => {
  const limiter = createSlotLimiter();
  let running = 0;
  let peak = 0;
  const started: number[] = [];
  const releases: (() => void)[] = [];
  let cancelled = false;
  const task = (id: number) => () => {
    started.push(id);
    running++;
    peak = Math.max(peak, running);
    return new Promise<number>((resolve) =>
      releases.push(() => {
        running--;
        resolve(id);
      }),
    );
  };
  const results = Array.from({ length: 7 }, (_, id) => limiter.run(task(id), () => cancelled));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(started).toEqual([0, 1, 2, 3]);
  expect(peak).toBe(RAIL_POLL_CONCURRENCY);
  releases.shift()!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(started).toEqual([0, 1, 2, 3, 4]);
  cancelled = true;
  limiter.drain();
  for (const release of releases.splice(0)) release();
  expect(await Promise.all(results)).toEqual([0, 1, 2, 3, 4, undefined, undefined]);
  expect(started).toEqual([0, 1, 2, 3, 4]);
});
