import { afterEach, expect, it, vi } from "vitest";
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
  const { runLeases, scopes, hostRunsCalls, renew } = setup();
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
