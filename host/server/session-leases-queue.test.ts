import { expect, it, vi } from "vitest";
import { RunLeases } from "../execution/run-lease";
import { createSessionLeasesRuntime } from "./session-leases";

/** Mock store and queue: records every queue write and each stall check, so the beat's behavior is observable. */
function queueSetup(revisions: Record<string, number> = {}) {
  const calls: string[] = [];
  let scopes = 0;
  const holderStalled = vi.fn(async () => false);
  const renew = vi.fn(async (sessionId: string, _holder: string, epoch?: number) => {
    calls.push(`renew:${sessionId}:${epoch}`);
    return { holder: "desktop:client", epoch: epoch ?? 0, expiresAt: Date.now() + 60_000 };
  });
  const release = vi.fn(async (sessionId: string, _holder: string, epoch?: number) => {
    calls.push(`release:${sessionId}:${epoch}`);
    return null;
  });
  const dependencies = {
    desktop: { live: { busyClient: () => undefined } },
    touchSessionWorkspace: async () => undefined,
    engine: {
      hasActiveRun: () => false,
      hasRetainedProviderWriter: () => false,
      store: {
        db: {
          scope: (work: () => unknown) => {
            scopes++;
            return Promise.resolve(work());
          },
        },
      },
    },
    runLeases: new RunLeases(),
    hostRuns: async () => false,
    sessionQueues: {
      get: vi.fn(async (sessionId: string) => ({
        revision: revisions[sessionId] ?? 1,
        messages: [{}],
      })),
      renew,
      release,
    },
    queueDrainer: { noteBlocked: vi.fn(), holderStalled },
  };
  const runtime = createSessionLeasesRuntime(dependencies as never);
  const beat = (queueLeases: { sessionId: string; epoch: number; blocked?: boolean }[]) =>
    runtime.renewQueueLeases({ clientId: "client", queueLeases });
  return { beat, calls, holderStalled, release, renew, scopes: () => scopes };
}

it("renews a beat's queue leases inside one store scope", async () => {
  const q = queueSetup();
  await q.beat([
    { sessionId: "a", epoch: 1 },
    { sessionId: "b", epoch: 1 },
    { sessionId: "c", epoch: 1 },
  ]);
  expect(q.scopes()).toBe(1);
  expect(q.renew).toHaveBeenCalledTimes(3);
});

it("keeps the reported order of entries that share a session", async () => {
  const q = queueSetup();
  await q.beat([
    { sessionId: "a", epoch: 1 },
    { sessionId: "b", epoch: 1 },
    { sessionId: "a", epoch: 2 },
  ]);
  const a1 = q.calls.indexOf("renew:a:1");
  const a2 = q.calls.indexOf("renew:a:2");
  expect(a1).toBeGreaterThanOrEqual(0);
  expect(a2).toBeGreaterThan(a1);
});

it("answers a session listed twice with its last entry", async () => {
  const q = queueSetup();
  const leases = await q.beat([
    { sessionId: "a", epoch: 1 },
    { sessionId: "a", epoch: 2 },
  ]);
  expect(leases).toMatchObject({ a: { epoch: 2 } });
});

it("keeps the stall check and release for a stalled holder", async () => {
  const q = queueSetup();
  q.holderStalled.mockResolvedValueOnce(true);
  const leases = await q.beat([{ sessionId: "a", epoch: 3 }]);
  expect(q.release).toHaveBeenCalledWith("a", "desktop:client", 3);
  expect(leases).toEqual({ a: null });
});

it("reuses a cached answer while the queue's revision is unchanged", async () => {
  const revisions: Record<string, number> = { a: 5 };
  const q = queueSetup(revisions);
  await q.beat([{ sessionId: "a", epoch: 1 }]);
  await q.beat([{ sessionId: "a", epoch: 1 }]);
  expect(q.holderStalled).toHaveBeenCalledTimes(1);
  // A change to this queue ends the cached answer, whatever the global mutation counter did.
  revisions.a = 6;
  await q.beat([{ sessionId: "a", epoch: 1 }]);
  expect(q.holderStalled).toHaveBeenCalledTimes(2);
});
