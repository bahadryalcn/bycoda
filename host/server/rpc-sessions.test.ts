import { expect, it, vi } from "vitest";
import { handleSessionsRpc } from "./rpc-sessions";

type Gate = { promise: Promise<unknown>; resolve: (value: unknown) => void };

function gate(): Gate {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((done) => (resolve = done));
  return { promise, resolve };
}

it("starts the independent desktop heartbeat parts together and keeps the result shape", async () => {
  const started: string[] = [];
  const gates = {
    deletions: gate(),
    inbox: gate(),
    adopted: gate(),
    queueLeases: gate(),
  };
  const waitFor = (name: keyof typeof gates) => {
    started.push(name);
    return gates[name].promise;
  };
  const dependencies = {
    desktop: { live: { beat: () => ({ commands: [{ id: "live" }] }) } },
    pushNotifications: { desktopPresence: () => undefined, ownedEvents: async () => [] },
    desktopCommandDelivery: { poll: async () => [{ id: "durable" }] },
    renewRunLeases: async () => ({ s1: null }),
    heartbeatEffects: Promise.resolve(),
    withinBeat: (work: () => Promise<unknown>) => work(),
    desktopDelete: { beat: () => waitFor("deletions") },
    remoteActivity: { since: () => ({ seq: 0, events: [], reset: true }) },
    providerInbox: { beat: () => waitFor("inbox") },
    hostNotes: { revision: 7 },
    sessionQueues: { changesSince: () => ({ seq: 3 }) },
    adoptedChanges: { changesSince: () => waitFor("adopted") },
    renewQueueLeases: () => waitFor("queueLeases"),
  };
  const request = {
    input: { method: "sessions.desktopLive" },
    params: { clientId: "win1", queueSeq: 2, adoptedSeq: 4, deletions: [], inbox: [] },
    tokenHash: "token-hash",
    domainContext: {},
    result: undefined as unknown,
  };
  const done = handleSessionsRpc(dependencies as never, request as never);
  // Every part is already waiting on its store read before any of them resolves.
  await new Promise((resolve) => setImmediate(resolve));
  expect(started.sort()).toEqual(["adopted", "deletions", "inbox", "queueLeases"]);
  gates.deletions.resolve({ jobs: [{ id: "job" }], acked: [] });
  gates.inbox.resolve({ jobs: [], acked: ["m1"] });
  gates.adopted.resolve({ seq: 5, ids: ["a"] });
  gates.queueLeases.resolve({ q1: null });
  await done;
  expect(request.result).toEqual({
    commands: [{ id: "live" }, { id: "durable" }],
    deletions: { jobs: [{ id: "job" }], acked: [] },
    hostPush: [],
    inbox: { jobs: [], acked: ["m1"] },
    notesRevision: 7,
    queues: { seq: 3 },
    adopted: { seq: 5, ids: ["a"] },
    queueLeases: { q1: null },
    runLeases: { s1: null },
    activity: { seq: 0, events: [], reset: true },
  });
});

it("refuses to delete or archive a crew-managed session with the crew message", async () => {
  const store = {
    db: {
      prepare: () => ({
        get: async (...args: unknown[]) =>
          args[0] === "lead-session" ? { run_id: "run" } : undefined,
      }),
    },
  };
  const dependencies = { engine: { store } };
  const message = "This conversation is managed by a crew. Stop or delete the work from Crews.";
  await expect(
    handleSessionsRpc(
      dependencies as never,
      {
        input: { method: "sessions.delete" },
        params: { sessionId: "lead-session", projectId: "p1" },
      } as never,
    ),
  ).rejects.toThrow(message);
  await expect(
    handleSessionsRpc(
      dependencies as never,
      {
        input: { method: "sessions.update" },
        params: { sessionId: "lead-session", projectId: "p1", archived: true },
      } as never,
    ),
  ).rejects.toMatchObject({ code: "crew_managed_session" });
});

it("bounds optional push ownership lookup while answering the desktop heartbeat", async () => {
  const hostPush = gate();
  const bounded = vi.fn((work: () => Promise<unknown>, fallback: unknown) => {
    const pending = work();
    return Promise.race([pending, Promise.resolve(fallback)]);
  });
  const dependencies = {
    desktop: { live: { beat: () => ({ commands: [] }) } },
    pushNotifications: { desktopPresence: () => undefined, ownedEvents: () => hostPush.promise },
    desktopCommandDelivery: { poll: async () => [] },
    renewRunLeases: async () => undefined,
    heartbeatEffects: Promise.resolve(),
    withinBeat: bounded,
    desktopDelete: { beat: async () => ({ jobs: [], acked: [] }) },
    providerInbox: { beat: async () => ({ jobs: [], acked: [] }) },
    adoptedChanges: { changesSince: async () => undefined },
    renewQueueLeases: async () => undefined,
    hostNotes: { revision: 0 },
    sessionQueues: { changesSince: () => ({ seq: 0 }) },
    remoteActivity: { since: () => ({ seq: 0, events: [] }) },
  };
  const request = {
    input: { method: "sessions.desktopLive" },
    params: {},
    domainContext: {},
    result: undefined as unknown,
  };
  const done = handleSessionsRpc(dependencies as never, request as never);
  await new Promise((resolve) => setImmediate(resolve));
  const result = request.result;
  hostPush.resolve([]);
  await done;
  expect(result).toMatchObject({ commands: [] });
});
