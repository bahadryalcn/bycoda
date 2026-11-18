import { afterEach, expect, it, vi } from "vitest";
import { perfMetrics } from "../diagnostics/perf-metrics";
import { RunLeases } from "../execution/run-lease";
import { createSessionLeasesRuntime } from "./session-leases";

function setup(options: { scope?: () => Promise<unknown>; hostRunning?: boolean } = {}) {
  const runLeases = new RunLeases();
  const scopes = { count: 0 };
  const hostRunsCalls: string[] = [];
  const dependencies = {
    desktop: { live: { busyClient: () => undefined } },
    touchSessionWorkspace: async () => undefined,
    engine: {
      hasActiveRun: () => options.hostRunning ?? false,
      hasRetainedProviderWriter: () => false,
      store: {
        db: {
          dataMutationVersion: 0,
          scope: (work: () => unknown) => {
            scopes.count++;
            return options.scope ? options.scope() : Promise.resolve(work());
          },
        },
      },
    },
    runLeases,
    hostRuns: async (id: string) => {
      hostRunsCalls.push(id);
      return false;
    },
    sessionQueues: {},
    queueDrainer: {},
  };
  const runtime = createSessionLeasesRuntime(dependencies as never);
  const renew = (sessionIds: string[], epoch = 0) =>
    runtime.renewRunLeases({
      clientId: "win1",
      runLeases: sessionIds.map((sessionId) => ({ sessionId, epoch })),
    });
  return { runtime, runLeases, scopes, hostRunsCalls, renew };
}

afterEach(() => {
  vi.useRealTimers();
});

it("reads the store once for all the leases a beat grants", async () => {
  const { runLeases, scopes, hostRunsCalls, renew } = setup();
  const ids = ["s1", "s2", "s3", "s4", "s5"];
  const answers = await renew(ids);
  expect(scopes.count).toBe(1);
  expect(hostRunsCalls).toEqual(ids);
  for (const id of ids) expect(answers?.[id]?.holder).toBe("desktop:win1");
  expect(runLeases.holder("s3")?.holder).toBe("desktop:win1");
});

it("answers held leases from memory without touching the store", async () => {
  const { scopes, hostRunsCalls, renew } = setup();
  const granted = await renew(["s1"]);
  scopes.count = 0;
  hostRunsCalls.length = 0;
  const renewed = await renew(["s1"], granted?.s1?.epoch);
  expect(renewed?.s1?.epoch).toBe(granted?.s1?.epoch);
  expect(scopes.count).toBe(0);
  expect(hostRunsCalls).toEqual([]);
});

it("answers from the engine's memory of its runs when the store read times out", async () => {
  vi.useFakeTimers();
  const { runtime, runLeases, renew } = setup({ scope: () => new Promise(() => undefined) });
  const pending = renew(["s1", "s2"]);
  await vi.advanceTimersByTimeAsync(runtime.BEAT_STORE_WAIT_MS);
  const answers = await pending;
  expect(answers?.s1?.holder).toBe("desktop:win1");
  expect(answers?.s2?.holder).toBe("desktop:win1");
  expect(runLeases.holder("s2")?.holder).toBe("desktop:win1");
});

it("does not grant a lease the engine's memory says the host runs", async () => {
  vi.useFakeTimers();
  const { runtime, renew } = setup({
    scope: () => new Promise(() => undefined),
    hostRunning: true,
  });
  const pending = renew(["s1"]);
  await vi.advanceTimersByTimeAsync(runtime.BEAT_STORE_WAIT_MS);
  expect((await pending)?.s1).toBeNull();
});

it("records a busy session's workspace activity once per interval, not on every beat", async () => {
  vi.useFakeTimers();
  const touch = vi.fn(async () => undefined);
  const live = {
    busyClient: () => "win1" as string | undefined,
    onBusy: undefined as ((id: string, clientId: string) => void) | undefined,
    onIdle: undefined as ((id: string, clientId: string, reason: string) => void) | undefined,
  };
  createSessionLeasesRuntime({
    desktop: { live },
    touchSessionWorkspace: touch,
    engine: {
      hasRetainedProviderWriter: () => false,
      store: { db: { scope: (work: () => unknown) => Promise.resolve(work()) } },
    },
    runLeases: new RunLeases(),
    hostRuns: async () => false,
    sessionQueues: {},
    queueDrainer: {},
  } as never);
  const beat = async (id = "s1") => {
    live.onBusy!(id, "win1");
    await vi.advanceTimersByTimeAsync(0);
  };
  await beat();
  await vi.advanceTimersByTimeAsync(5_000);
  await beat();
  await vi.advanceTimersByTimeAsync(5_000);
  await beat();
  expect(touch).toHaveBeenCalledTimes(1);
  await beat("s2");
  expect(touch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30_000);
  await beat();
  expect(touch).toHaveBeenCalledTimes(3);
  // A turn that ends records its end, and its next turn's first beat records again.
  live.onIdle!("s1", "win1", "idle");
  await vi.advanceTimersByTimeAsync(0);
  expect(touch).toHaveBeenCalledTimes(4);
  await beat();
  expect(touch).toHaveBeenCalledTimes(5);
});

const fallbackCount = (stage: string) =>
  perfMetrics.snapshot().metrics.find((metric) => metric.name === `${stage}.fallback`)?.count ?? 0;

it("runs one copy of a slow heartbeat stage per window and counts each fallback", async () => {
  vi.useFakeTimers();
  const { runtime } = setup();
  const stage = { name: "desktopLive.inbox", owner: "device:win1" };
  const before = fallbackCount(stage.name);
  let finish!: (value: string) => void;
  const work = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)));
  const first = runtime.withinBeat(work, "no news", stage);
  await vi.advanceTimersByTimeAsync(runtime.BEAT_STORE_WAIT_MS);
  expect(await first).toBe("no news");
  // The next beat finds the first copy still running and does not start another.
  expect(await runtime.withinBeat(work, "no news", stage)).toBe("no news");
  expect(work).toHaveBeenCalledTimes(1);
  // Another window's stage is independent.
  const other = runtime.withinBeat(async () => "answer", "no news", { ...stage, owner: "w2" });
  expect(await other).toBe("answer");
  expect(fallbackCount(stage.name)).toBe(before + 2);
  // Once the copy settles, the next beat runs the work again.
  finish("late");
  await vi.advanceTimersByTimeAsync(0);
  const fresh = vi.fn(async () => "fresh");
  expect(await runtime.withinBeat(fresh, "no news", stage)).toBe("fresh");
  expect(fresh).toHaveBeenCalledTimes(1);
});
